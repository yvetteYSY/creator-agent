import { parseWebVtt, WebVttValidationError } from "@creator-agent/core";
import type { Pool, PoolClient } from "pg";
import { recordAuditEvent } from "./audit";
import { WorkspaceRecordNotFoundError, WorkspaceStateConflictError } from "./workspace-store";

export type TranscriptStatus = "draft" | "approved" | "rejected";

export interface TranscriptRecord {
  sourceId: string;
  version: number;
  status: TranscriptStatus;
  format: "text/vtt";
  content: string;
  cueCount: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface TranscriptRepository {
  get(ownerId: string, agentId: string, sourceId: string): Promise<TranscriptRecord>;
  saveDraft(ownerId: string, agentId: string, sourceId: string, content: string): Promise<TranscriptRecord>;
  review(
    ownerId: string,
    agentId: string,
    sourceId: string,
    status: "approved" | "rejected",
  ): Promise<TranscriptRecord>;
}

interface TranscriptRow {
  source_id: string;
  version: number;
  status: TranscriptStatus;
  format: "text/vtt";
  webvtt: string;
  cue_count: number;
  duration_ms: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  approved_at: Date | string | null;
  rejected_at: Date | string | null;
}

const TRANSCRIPT_COLUMNS = `source_id, version, status, format, webvtt, cue_count, duration_ms,
  created_at, updated_at, approved_at, rejected_at`;

export class PostgresTranscriptRepository implements TranscriptRepository {
  constructor(private readonly pool: Pool) {}

  async get(ownerId: string, agentId: string, sourceId: string) {
    const result = await this.pool.query<TranscriptRow>(
      `SELECT ${TRANSCRIPT_COLUMNS}
       FROM source_transcripts
       WHERE owner_id = $1 AND agent_id = $2 AND source_id = $3 AND deleted_at IS NULL`,
      [ownerId, agentId, sourceId],
    );
    if (!result.rows[0]) throw new WorkspaceRecordNotFoundError("Transcript not found.");
    return mapTranscript(result.rows[0]);
  }

  async saveDraft(ownerId: string, agentId: string, sourceId: string, content: string) {
    let parsed;
    try {
      parsed = parseWebVtt(content);
    } catch (error) {
      if (error instanceof WebVttValidationError) throw error;
      throw new WebVttValidationError("Choose a valid WebVTT transcript.");
    }
    if (parsed.durationMs > 14_400_000) {
      throw new WebVttValidationError("WebVTT duration must not exceed 4 hours.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await lockEligibleSource(client, ownerId, agentId, sourceId);
      if (source.malware_scan_status !== "clean" || !["processing", "ready"].includes(source.status)) {
        throw new WorkspaceStateConflictError("The video must pass quarantine scanning before transcript review.");
      }
      if (source.detected_duration_ms === null || parsed.durationMs > source.detected_duration_ms + 5_000) {
        throw new WebVttValidationError("WebVTT timestamps exceed the inspected video duration.");
      }
      const result = await client.query<TranscriptRow>(
        `INSERT INTO source_transcripts (
           source_id, owner_id, agent_id, webvtt, cue_count, duration_ms
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_id) DO UPDATE SET
           version = source_transcripts.version + 1,
           status = 'draft', webvtt = EXCLUDED.webvtt,
           cue_count = EXCLUDED.cue_count, duration_ms = EXCLUDED.duration_ms,
           approved_at = NULL, rejected_at = NULL, deleted_at = NULL, updated_at = now()
         RETURNING ${TRANSCRIPT_COLUMNS}`,
        [sourceId, ownerId, agentId, parsed.normalized, parsed.cues.length, parsed.durationMs],
      );
      await client.query(
        `UPDATE sources SET status = 'processing', visibility = 'preview', updated_at = now()
         WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [ownerId, agentId, sourceId],
      );
      const transcript = mapTranscript(result.rows[0]!);
      await recordAuditEvent(client, {
        actor: { type: "creator", id: ownerId },
        action: "source.transcript_saved",
        targetType: "source",
        targetId: sourceId,
        metadata: {
          status: transcript.status,
          version: transcript.version,
          cueCount: transcript.cueCount,
          durationMs: transcript.durationMs,
        },
      });
      await client.query("COMMIT");
      return transcript;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async review(
    ownerId: string,
    agentId: string,
    sourceId: string,
    status: "approved" | "rejected",
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await lockEligibleSource(client, ownerId, agentId, sourceId);
      if (source.malware_scan_status !== "clean" || !["processing", "ready"].includes(source.status)) {
        throw new WorkspaceStateConflictError("The video must pass quarantine scanning before transcript review.");
      }
      const result = await client.query<TranscriptRow>(
        `UPDATE source_transcripts
         SET status = $4,
           approved_at = CASE WHEN $4 = 'approved' THEN now() ELSE NULL END,
           rejected_at = CASE WHEN $4 = 'rejected' THEN now() ELSE NULL END,
           updated_at = now()
         WHERE owner_id = $1 AND agent_id = $2 AND source_id = $3
           AND deleted_at IS NULL AND status = 'draft'
         RETURNING ${TRANSCRIPT_COLUMNS}`,
        [ownerId, agentId, sourceId, status],
      );
      if (!result.rows[0]) {
        const current = await client.query<TranscriptRow>(
          `SELECT ${TRANSCRIPT_COLUMNS} FROM source_transcripts
           WHERE owner_id = $1 AND agent_id = $2 AND source_id = $3 AND deleted_at IS NULL`,
          [ownerId, agentId, sourceId],
        );
        if (!current.rows[0]) throw new WorkspaceRecordNotFoundError("Transcript not found.");
        if (current.rows[0].status === status) {
          await client.query("COMMIT");
          return mapTranscript(current.rows[0]);
        }
        throw new WorkspaceStateConflictError("Only a draft transcript can be reviewed.");
      }
      await client.query(
        `UPDATE sources
         SET status = $4, visibility = 'preview', updated_at = now()
         WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [ownerId, agentId, sourceId, status === "approved" ? "ready" : "processing"],
      );
      await recordAuditEvent(client, {
        actor: { type: "creator", id: ownerId },
        action: status === "approved" ? "source.transcript_approved" : "source.transcript_rejected",
        targetType: "source",
        targetId: sourceId,
        metadata: { status, version: result.rows[0].version },
      });
      await client.query("COMMIT");
      return mapTranscript(result.rows[0]);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function lockEligibleSource(
  client: PoolClient,
  ownerId: string,
  agentId: string,
  sourceId: string,
) {
  const result = await client.query<{
    status: string;
    malware_scan_status: string | null;
    detected_duration_ms: number | null;
  }>(
    `SELECT status, malware_scan_status, detected_duration_ms FROM sources
     WHERE owner_id = $1 AND agent_id = $2 AND id = $3
       AND type = 'video' AND deleted_at IS NULL
     FOR UPDATE`,
    [ownerId, agentId, sourceId],
  );
  if (!result.rows[0]) throw new WorkspaceRecordNotFoundError("Video source not found.");
  return {
    ...result.rows[0],
    detected_duration_ms: result.rows[0].detected_duration_ms === null
      ? null
      : Number(result.rows[0].detected_duration_ms),
  };
}

function mapTranscript(row: TranscriptRow): TranscriptRecord {
  return {
    sourceId: row.source_id,
    version: row.version,
    status: row.status,
    format: row.format,
    content: row.webvtt,
    cueCount: row.cue_count,
    durationMs: Number(row.duration_ms),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.approved_at ? { approvedAt: iso(row.approved_at) } : {}),
    ...(row.rejected_at ? { rejectedAt: iso(row.rejected_at) } : {}),
  };
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the transaction failure that caused the rollback.
  }
}
