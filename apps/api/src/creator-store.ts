import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthenticatedPrincipal } from "./auth";

export interface CreatorRecord {
  id: string;
  issuer: string;
  subject: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface CreatorRepository {
  upsertIdentity(principal: AuthenticatedPrincipal): Promise<CreatorRecord>;
}

export class CreatorAccessRevokedError extends Error {}

interface UserRow {
  id: string;
  auth_issuer: string;
  auth_subject: string;
  created_at: Date | string;
  last_seen_at: Date | string;
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresCreatorRepository implements CreatorRepository {
  constructor(private readonly pool: Pool) {}

  async upsertIdentity(principal: AuthenticatedPrincipal): Promise<CreatorRecord> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, auth_issuer, auth_subject)
       VALUES ($1, $2, $3)
       ON CONFLICT (auth_issuer, auth_subject)
       DO UPDATE SET last_seen_at = now()
       WHERE users.deleted_at IS NULL
       RETURNING id, auth_issuer, auth_subject, created_at, last_seen_at`,
      [randomUUID(), principal.issuer, principal.subject],
    );
    const row = result.rows[0];
    if (!row) throw new CreatorAccessRevokedError("This creator identity is unavailable.");
    return {
      id: row.id,
      issuer: row.auth_issuer,
      subject: row.auth_subject,
      createdAt: toIsoString(row.created_at),
      lastSeenAt: toIsoString(row.last_seen_at),
    };
  }
}
