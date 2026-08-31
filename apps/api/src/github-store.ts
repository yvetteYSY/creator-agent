import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { recordAuditEvent } from "./audit";
import type { GitHubInstallation, GitHubTextFile } from "./github-app";
import type { SourceRecord } from "./workspace-store";

export type GitHubInstallationStatus = "active" | "suspended" | "revoked";

export interface GitHubInstallationRecord extends GitHubInstallation {
  ownerId: string;
  status: GitHubInstallationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubImportInput {
  installationId: number;
  title: string;
  repositoryOwner: string;
  repositoryName: string;
  path: string;
  ref?: string;
  file: GitHubTextFile;
}

export interface GitHubImportResult {
  source: SourceRecord;
  content: string;
  origin: {
    repository: string;
    path: string;
    ref?: string;
    sha: string;
    htmlUrl: string;
  };
}

export interface GitHubIntegrationRepository {
  beginConnection(ownerId: string, stateDigest: string, expiresAt: string): Promise<void>;
  completeConnection(stateDigest: string, installation: GitHubInstallation): Promise<GitHubInstallationRecord>;
  listInstallations(ownerId: string): Promise<GitHubInstallationRecord[]>;
  getInstallation(ownerId: string, installationId: number): Promise<GitHubInstallationRecord>;
  importTextSource(ownerId: string, agentId: string, input: GitHubImportInput): Promise<GitHubImportResult>;
  updateInstallationStatus(installationId: number, status: GitHubInstallationStatus): Promise<void>;
}

export class GitHubConnectionStateError extends Error {}
export class GitHubInstallationConflictError extends Error {}
export class GitHubInstallationNotFoundError extends Error {}

interface InstallationRow {
  id: number | string;
  owner_id: string;
  account_login: string;
  account_type: "User" | "Organization";
  repository_selection: "all" | "selected";
  status: GitHubInstallationStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SourceRow {
  id: string;
  owner_id: string;
  agent_id: string;
  title: string;
  type: "document";
  status: "ready";
  visibility: "preview";
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresGitHubIntegrationRepository implements GitHubIntegrationRepository {
  constructor(private readonly pool: Pool) {}

  async beginConnection(ownerId: string, stateDigest: string, expiresAt: string) {
    await this.pool.query(
      `INSERT INTO github_connection_sessions (state_digest, owner_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (state_digest) DO NOTHING`,
      [stateDigest, ownerId, expiresAt],
    );
  }

  async completeConnection(stateDigest: string, installation: GitHubInstallation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query<{ owner_id: string }>(
        `DELETE FROM github_connection_sessions
         WHERE state_digest = $1 AND expires_at > now()
         RETURNING owner_id`,
        [stateDigest],
      );
      const ownerId = session.rows[0]?.owner_id;
      if (!ownerId) throw new GitHubConnectionStateError("The GitHub connection session is invalid or expired.");
      const result = await client.query<InstallationRow>(
        `INSERT INTO github_installations (
           id, owner_id, account_login, account_type, repository_selection, status
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
         SET account_login = EXCLUDED.account_login,
             account_type = EXCLUDED.account_type,
             repository_selection = EXCLUDED.repository_selection,
             status = EXCLUDED.status,
             updated_at = now()
         WHERE github_installations.owner_id = EXCLUDED.owner_id
         RETURNING id, owner_id, account_login, account_type, repository_selection,
                   status, created_at, updated_at`,
        [
          installation.id,
          ownerId,
          installation.accountLogin,
          installation.accountType,
          installation.repositorySelection,
          installation.suspended ? "suspended" : "active",
        ],
      );
      if (!result.rows[0]) throw new GitHubInstallationConflictError("This GitHub installation is already connected to another creator.");
      await client.query("COMMIT");
      return mapInstallation(result.rows[0]);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listInstallations(ownerId: string) {
    const result = await this.pool.query<InstallationRow>(
      `SELECT id, owner_id, account_login, account_type, repository_selection,
              status, created_at, updated_at
       FROM github_installations
       WHERE owner_id = $1
       ORDER BY updated_at DESC, id`,
      [ownerId],
    );
    return result.rows.map(mapInstallation);
  }

  async getInstallation(ownerId: string, installationId: number) {
    const result = await this.pool.query<InstallationRow>(
      `SELECT id, owner_id, account_login, account_type, repository_selection,
              status, created_at, updated_at
       FROM github_installations
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, installationId],
    );
    if (!result.rows[0]) throw new GitHubInstallationNotFoundError("GitHub installation not found.");
    return mapInstallation(result.rows[0]);
  }

  async importTextSource(ownerId: string, agentId: string, input: GitHubImportInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const source = await client.query<SourceRow>(
        `INSERT INTO sources (id, owner_id, agent_id, title, type, status, visibility)
         SELECT $1, a.owner_id, a.id, $4, 'document', 'ready', 'preview'
         FROM agents a
         JOIN github_installations i
           ON i.owner_id = a.owner_id AND i.id = $5 AND i.status = 'active'
         WHERE a.owner_id = $2 AND a.id = $3 AND a.deleted_at IS NULL
         RETURNING id, owner_id, agent_id, title, type, status, visibility, created_at, updated_at`,
        [id, ownerId, agentId, input.title, input.installationId],
      );
      const row = source.rows[0];
      if (!row) throw new GitHubInstallationNotFoundError("The active GitHub installation or agent was not found.");
      await client.query(
        `INSERT INTO github_source_imports (
           source_id, owner_id, agent_id, installation_id, repository_owner,
           repository_name, path, git_ref, blob_sha, html_url, content, byte_size
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id, ownerId, agentId, input.installationId, input.repositoryOwner,
          input.repositoryName, input.path, input.ref ?? null, input.file.sha,
          input.file.htmlUrl, input.file.content, input.file.size,
        ],
      );
      await recordAuditEvent(client, {
        actor: { type: "creator", id: ownerId },
        action: "source.github_imported",
        targetType: "source",
        targetId: id,
        metadata: { type: "document", status: "ready", visibility: "preview" },
      });
      await client.query("COMMIT");
      return {
        source: mapSource(row),
        content: input.file.content,
        origin: {
          repository: `${input.repositoryOwner}/${input.repositoryName}`,
          path: input.path,
          ...(input.ref ? { ref: input.ref } : {}),
          sha: input.file.sha,
          htmlUrl: input.file.htmlUrl,
        },
      };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateInstallationStatus(installationId: number, status: GitHubInstallationStatus) {
    await this.pool.query(
      `UPDATE github_installations SET status = $2, updated_at = now() WHERE id = $1`,
      [installationId, status],
    );
  }
}

function mapInstallation(row: InstallationRow): GitHubInstallationRecord {
  return {
    id: Number(row.id),
    ownerId: row.owner_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    repositorySelection: row.repository_selection,
    suspended: row.status === "suspended",
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    title: row.title,
    type: row.type,
    status: row.status,
    visibility: row.visibility,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}
