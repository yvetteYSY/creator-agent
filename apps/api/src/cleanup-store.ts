import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { recordAuditEvent } from "./audit";

export interface StorageDeletionJob {
  sourceId: string;
  storageKey: string;
  leaseId: string;
  attempt: number;
}

export interface StorageDeletionRepository {
  claimNext(input: { staleBefore: Date; maxAttempts: number }): Promise<StorageDeletionJob | null>;
  complete(job: StorageDeletionJob): Promise<boolean>;
  release(job: StorageDeletionJob, failureCode: string): Promise<boolean>;
}

interface DeletionRow {
  id: string;
  storage_key: string;
  deletion_attempts: number;
}

export class PostgresStorageDeletionRepository implements StorageDeletionRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(input: { staleBefore: Date; maxAttempts: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<DeletionRow>(
        `SELECT id, storage_key, deletion_attempts
         FROM sources
         WHERE deleted_at IS NOT NULL
           AND storage_key IS NOT NULL
           AND storage_deleted_at IS NULL
           AND deletion_attempts < $2
           AND (deletion_lease_id IS NULL OR deletion_started_at < $1)
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
      const claimed = await client.query<DeletionRow>(
        `UPDATE sources
         SET deletion_lease_id = $2, deletion_started_at = now(),
           deletion_attempts = deletion_attempts + 1,
           deletion_failure_code = NULL, updated_at = now()
         WHERE id = $1 AND deleted_at IS NOT NULL AND storage_deleted_at IS NULL
         RETURNING id, storage_key, deletion_attempts`,
        [row.id, leaseId],
      );
      await recordAuditEvent(client, {
        actor: { type: "system" },
        action: "source.storage_deletion_claimed",
        targetType: "source",
        targetId: row.id,
        metadata: { attempt: row.deletion_attempts + 1 },
      });
      await client.query("COMMIT");
      const job = claimed.rows[0]!;
      return {
        sourceId: job.id,
        storageKey: job.storage_key,
        leaseId,
        attempt: job.deletion_attempts,
      };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(job: StorageDeletionJob) {
    return this.finish(job, null);
  }

  async release(job: StorageDeletionJob, failureCode: string) {
    return this.finish(job, failureCode);
  }

  private async finish(job: StorageDeletionJob, failureCode: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = failureCode === null
        ? await client.query(
          `UPDATE sources
           SET storage_deleted_at = now(), deletion_lease_id = NULL,
             deletion_failure_code = NULL, updated_at = now()
           WHERE id = $1 AND deletion_lease_id = $2
             AND deleted_at IS NOT NULL AND storage_deleted_at IS NULL
           RETURNING id`,
          [job.sourceId, job.leaseId],
        )
        : await client.query(
          `UPDATE sources
           SET deletion_lease_id = NULL, deletion_failure_code = $3, updated_at = now()
           WHERE id = $1 AND deletion_lease_id = $2
             AND deleted_at IS NOT NULL AND storage_deleted_at IS NULL
           RETURNING id`,
          [job.sourceId, job.leaseId, failureCode],
        );
      if (result.rows[0]) {
        await recordAuditEvent(client, {
          actor: { type: "system" },
          action: failureCode === null
            ? "source.storage_deletion_completed"
            : "source.storage_deletion_released",
          targetType: "source",
          targetId: job.sourceId,
          metadata: { attempt: job.attempt, failureCode },
        });
      }
      await client.query("COMMIT");
      return Boolean(result.rows[0]);
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
