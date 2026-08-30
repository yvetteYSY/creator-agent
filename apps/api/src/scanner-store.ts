import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { recordAuditEvent } from "./audit";

export interface ScanJob {
  sourceId: string;
  storageKey: string;
  expectedContentType: string;
  expectedSize: number;
  leaseId: string;
  attempt: number;
}

export interface DetectedMediaMetadata {
  mediaType: "video/mp4";
  durationMs: number;
  videoCodec: string;
  audioCodec: string;
}

export interface CleanMalwareScanMetadata {
  status: "clean";
  scanner: string;
}

export interface InfectedMalwareScanMetadata {
  status: "infected";
  scanner: string;
}

export type MalwareScanMetadata = CleanMalwareScanMetadata | InfectedMalwareScanMetadata;

export interface ScanRepository {
  claimNext(input: { staleBefore: Date; maxAttempts: number }): Promise<ScanJob | null>;
  complete(job: ScanJob, media: DetectedMediaMetadata, malware: CleanMalwareScanMetadata): Promise<boolean>;
  fail(job: ScanJob, failureCode: string, malware?: InfectedMalwareScanMetadata): Promise<boolean>;
  release(job: ScanJob, failureCode: string): Promise<boolean>;
}

interface ScanRow {
  id: string;
  storage_key: string;
  expected_content_type: string;
  expected_size: number | string;
  scan_attempts: number;
}

export class PostgresScanRepository implements ScanRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(input: { staleBefore: Date; maxAttempts: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<ScanRow>(
        `SELECT id, storage_key, expected_content_type, expected_size, scan_attempts
         FROM sources
         WHERE deleted_at IS NULL
           AND type = 'video'
           AND storage_key IS NOT NULL
           AND expected_content_type = 'video/mp4'
           AND expected_size IS NOT NULL
           AND scan_attempts < $2
           AND (
             status = 'uploaded'
             OR (status = 'scanning' AND scan_started_at < $1)
           )
         ORDER BY updated_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [input.staleBefore, input.maxAttempts],
      );
      const row = selected.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const leaseId = randomUUID();
      const claimed = await client.query<ScanRow>(
        `UPDATE sources
         SET status = 'scanning', visibility = 'preview', scan_lease_id = $2,
           scan_started_at = now(), scan_attempts = scan_attempts + 1,
           failure_code = NULL, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, storage_key, expected_content_type, expected_size, scan_attempts`,
        [row.id, leaseId],
      );
      await recordAuditEvent(client, {
        actor: { type: "system" },
        action: "source.scan_claimed",
        targetType: "source",
        targetId: row.id,
        metadata: { attempt: row.scan_attempts + 1 },
      });
      await client.query("COMMIT");
      const job = claimed.rows[0]!;
      return {
        sourceId: job.id,
        storageKey: job.storage_key,
        expectedContentType: job.expected_content_type,
        expectedSize: Number(job.expected_size),
        leaseId,
        attempt: job.scan_attempts,
      };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(job: ScanJob, media: DetectedMediaMetadata, malware: CleanMalwareScanMetadata) {
    return this.finish(job, {
      status: "processing",
      visibility: "preview",
      detectedMediaType: media.mediaType,
      detectedDurationMs: media.durationMs,
      detectedVideoCodec: media.videoCodec,
      detectedAudioCodec: media.audioCodec,
      malwareStatus: malware.status,
      malwareScanner: malware.scanner,
      failureCode: null,
    });
  }

  async fail(job: ScanJob, failureCode: string, malware?: InfectedMalwareScanMetadata) {
    return this.finish(job, {
      status: "failed",
      visibility: "disabled",
      detectedMediaType: null,
      detectedDurationMs: null,
      detectedVideoCodec: null,
      detectedAudioCodec: null,
      malwareStatus: malware?.status ?? null,
      malwareScanner: malware?.scanner ?? null,
      failureCode,
    });
  }

  async release(job: ScanJob, failureCode: string) {
    return this.finish(job, {
      status: "uploaded",
      visibility: "preview",
      detectedMediaType: null,
      detectedDurationMs: null,
      detectedVideoCodec: null,
      detectedAudioCodec: null,
      malwareStatus: null,
      malwareScanner: null,
      failureCode,
    });
  }

  private async finish(
    job: ScanJob,
    result: {
      status: "uploaded" | "processing" | "failed";
      visibility: "preview" | "disabled";
      detectedMediaType: string | null;
      detectedDurationMs: number | null;
      detectedVideoCodec: string | null;
      detectedAudioCodec: string | null;
      malwareStatus: "clean" | "infected" | null;
      malwareScanner: string | null;
      failureCode: string | null;
    },
  ) {
    const completed = result.status === "processing" || result.status === "failed";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const response = await client.query(
        `UPDATE sources
         SET status = $3, visibility = $4, detected_media_type = $5,
           detected_duration_ms = $6, detected_video_codec = $7, detected_audio_codec = $8,
           malware_scan_status = $9, malware_scanner = $10,
           malware_scanned_at = CASE WHEN $9::text IS NULL THEN NULL ELSE now() END,
           failure_code = $11,
           scan_completed_at = CASE WHEN $12 THEN now() ELSE scan_completed_at END,
           scan_lease_id = NULL, updated_at = now()
         WHERE id = $1 AND scan_lease_id = $2 AND status = 'scanning' AND deleted_at IS NULL
         RETURNING id`,
        [
          job.sourceId,
          job.leaseId,
          result.status,
          result.visibility,
          result.detectedMediaType,
          result.detectedDurationMs,
          result.detectedVideoCodec,
          result.detectedAudioCodec,
          result.malwareStatus,
          result.malwareScanner,
          result.failureCode,
          completed,
        ],
      );
      if (response.rows[0]) {
        await recordAuditEvent(client, {
          actor: { type: "system" },
          action: result.status === "processing"
            ? "source.scan_passed"
            : result.status === "failed" ? "source.scan_failed" : "source.scan_released",
          targetType: "source",
          targetId: job.sourceId,
          metadata: {
            status: result.status,
            attempt: job.attempt,
            failureCode: result.failureCode,
            ...(result.status === "processing" ? {
              durationMs: result.detectedDurationMs,
              videoCodec: result.detectedVideoCodec,
              audioCodec: result.detectedAudioCodec,
              malwareStatus: result.malwareStatus,
              malwareScanner: result.malwareScanner,
            } : {}),
            ...(result.status === "failed" && result.malwareStatus ? {
              malwareStatus: result.malwareStatus,
              malwareScanner: result.malwareScanner,
            } : {}),
          },
        });
      }
      await client.query("COMMIT");
      return Boolean(response.rows[0]);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the transaction failure that caused the rollback.
  }
}
