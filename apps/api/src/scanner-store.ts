import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export interface ScanJob {
  sourceId: string;
  storageKey: string;
  expectedContentType: string;
  expectedSize: number;
  leaseId: string;
  attempt: number;
}

export interface ScanRepository {
  claimNext(input: { staleBefore: Date; maxAttempts: number }): Promise<ScanJob | null>;
  complete(job: ScanJob, detectedMediaType: string): Promise<boolean>;
  fail(job: ScanJob, failureCode: string): Promise<boolean>;
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

  async complete(job: ScanJob, detectedMediaType: string) {
    return this.finish(job, {
      status: "processing",
      visibility: "preview",
      detectedMediaType,
      failureCode: null,
    });
  }

  async fail(job: ScanJob, failureCode: string) {
    return this.finish(job, {
      status: "failed",
      visibility: "disabled",
      detectedMediaType: null,
      failureCode,
    });
  }

  async release(job: ScanJob, failureCode: string) {
    return this.finish(job, {
      status: "uploaded",
      visibility: "preview",
      detectedMediaType: null,
      failureCode,
    });
  }

  private async finish(
    job: ScanJob,
    result: {
      status: "uploaded" | "processing" | "failed";
      visibility: "preview" | "disabled";
      detectedMediaType: string | null;
      failureCode: string | null;
    },
  ) {
    const completed = result.status === "processing" || result.status === "failed";
    const response = await this.pool.query(
      `UPDATE sources
       SET status = $3, visibility = $4, detected_media_type = $5, failure_code = $6,
         scan_completed_at = CASE WHEN $7 THEN now() ELSE scan_completed_at END,
         scan_lease_id = NULL, updated_at = now()
       WHERE id = $1 AND scan_lease_id = $2 AND status = 'scanning' AND deleted_at IS NULL
       RETURNING id`,
      [
        job.sourceId,
        job.leaseId,
        result.status,
        result.visibility,
        result.detectedMediaType,
        result.failureCode,
        completed,
      ],
    );
    return Boolean(response.rows[0]);
  }
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the transaction failure that caused the rollback.
  }
}
