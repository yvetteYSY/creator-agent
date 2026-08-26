import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type AgentStatus = "draft" | "published" | "unpublished";
export type SourceType = "document" | "audio" | "video";
export type SourceStatus = "awaiting_upload" | "uploaded" | "processing" | "ready" | "failed" | "deleting";
export type SourceVisibility = "preview" | "public" | "disabled";
export type StylePreset = "warm" | "direct" | "curious" | "custom";
export type ResponseLength = "short" | "balanced" | "deep";

export interface AgentConfigurationRecord {
  instructions: string;
  tone: string;
  boundaries: string[];
  stylePreset: StylePreset;
  responseLength: ResponseLength;
  signaturePhrases: string[];
  prohibitedTopics: string[];
  greeting: string;
}

export interface AgentRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  status: AgentStatus;
  configurationVersion: number;
  configuration: AgentConfigurationRecord;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput extends AgentConfigurationRecord {
  name: string;
  description: string;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  instructions?: string;
  tone?: string;
  boundaries?: string[];
  stylePreset?: StylePreset;
  responseLength?: ResponseLength;
  signaturePhrases?: string[];
  prohibitedTopics?: string[];
  greeting?: string;
}

export interface SourceRecord {
  id: string;
  ownerId: string;
  agentId: string;
  title: string;
  type: SourceType;
  status: SourceStatus;
  visibility: SourceVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSourceInput {
  title: string;
  type: SourceType;
  upload?: {
    storageKey: string;
    contentType: string;
    size: number;
    expiresAt: string;
  };
}

export interface UploadSourceRecord extends SourceRecord {
  storageKey: string;
  expectedContentType: string;
  expectedSize: number;
  uploadExpiresAt: string;
}

export interface WorkspaceRepository {
  listAgents(ownerId: string): Promise<AgentRecord[]>;
  getAgent(ownerId: string, agentId: string): Promise<AgentRecord>;
  createAgent(ownerId: string, input: CreateAgentInput): Promise<AgentRecord>;
  updateAgent(ownerId: string, agentId: string, input: UpdateAgentInput): Promise<AgentRecord>;
  listSources(ownerId: string, agentId: string): Promise<SourceRecord[]>;
  createSource(ownerId: string, agentId: string, input: CreateSourceInput): Promise<SourceRecord>;
  updateSourceVisibility(ownerId: string, agentId: string, sourceId: string, visibility: SourceVisibility): Promise<SourceRecord>;
  getSourceUpload(ownerId: string, agentId: string, sourceId: string): Promise<UploadSourceRecord>;
  markSourceUploaded(ownerId: string, agentId: string, sourceId: string): Promise<SourceRecord>;
  markSourceFailed(ownerId: string, agentId: string, sourceId: string): Promise<SourceRecord>;
  deleteSource(ownerId: string, agentId: string, sourceId: string): Promise<{ storageKey?: string }>;
}

export class WorkspaceRecordNotFoundError extends Error {}
export class WorkspaceStateConflictError extends Error {}

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  status: AgentStatus;
  configuration_version: number;
  instructions: string;
  tone: string;
  boundaries: unknown;
  style_preset: StylePreset;
  response_length: ResponseLength;
  signature_phrases: unknown;
  prohibited_topics: unknown;
  greeting: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SourceRow {
  id: string;
  owner_id: string;
  agent_id: string;
  title: string;
  type: SourceType;
  status: SourceStatus;
  visibility: SourceVisibility;
  created_at: Date | string;
  updated_at: Date | string;
  storage_key?: string | null;
  expected_content_type?: string | null;
  expected_size?: number | string | null;
  upload_expires_at?: Date | string | null;
}

const AGENT_SELECT = `SELECT a.id, a.owner_id, a.name, a.description, a.status,
  a.configuration_version, a.created_at, a.updated_at,
  c.instructions, c.tone, c.boundaries, c.style_preset, c.response_length,
  c.signature_phrases, c.prohibited_topics, c.greeting
  FROM agents a
  JOIN agent_configs c
    ON c.agent_id = a.id AND c.owner_id = a.owner_id AND c.version = a.configuration_version`;

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function boundaries(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    status: row.status,
    configurationVersion: row.configuration_version,
    configuration: {
      instructions: row.instructions,
      tone: row.tone,
      boundaries: boundaries(row.boundaries),
      stylePreset: row.style_preset,
      responseLength: row.response_length,
      signaturePhrases: boundaries(row.signature_phrases),
      prohibitedTopics: boundaries(row.prohibited_topics),
      greeting: row.greeting,
    },
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

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly pool: Pool) {}

  async listAgents(ownerId: string) {
    const result = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.owner_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.updated_at DESC, a.id`,
      [ownerId],
    );
    return result.rows.map(mapAgent);
  }

  async getAgent(ownerId: string, agentId: string) {
    const result = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.owner_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [ownerId, agentId],
    );
    if (!result.rows[0]) throw new WorkspaceRecordNotFoundError("Agent not found.");
    return mapAgent(result.rows[0]);
  }

  async createAgent(ownerId: string, input: CreateAgentInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const inserted = await client.query<AgentRow>(
        `INSERT INTO agents (id, owner_id, name, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, owner_id, name, description, status, configuration_version, created_at, updated_at`,
        [id, ownerId, input.name, input.description],
      );
      await client.query(
        `INSERT INTO agent_configs (
           agent_id, owner_id, version, instructions, tone, boundaries,
           style_preset, response_length, signature_phrases, prohibited_topics, greeting
         ) VALUES ($1, $2, 1, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10)`,
        [
          id,
          ownerId,
          input.instructions,
          input.tone,
          JSON.stringify(input.boundaries),
          input.stylePreset,
          input.responseLength,
          JSON.stringify(input.signaturePhrases),
          JSON.stringify(input.prohibitedTopics),
          input.greeting,
        ],
      );
      await client.query("COMMIT");
      return mapAgent({
        ...inserted.rows[0]!,
        instructions: input.instructions,
        tone: input.tone,
        boundaries: input.boundaries,
        style_preset: input.stylePreset,
        response_length: input.responseLength,
        signature_phrases: input.signaturePhrases,
        prohibited_topics: input.prohibitedTopics,
        greeting: input.greeting,
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAgent(ownerId: string, agentId: string, input: UpdateAgentInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<AgentRow>(
        `${AGENT_SELECT}
         WHERE a.owner_id = $1 AND a.id = $2 AND a.deleted_at IS NULL
         FOR UPDATE OF a`,
        [ownerId, agentId],
      );
      const current = currentResult.rows[0];
      if (!current) throw new WorkspaceRecordNotFoundError("Agent not found.");
      const nextVersion = current.configuration_version + 1;
      const updatedResult = await client.query<AgentRow>(
        `UPDATE agents
         SET name = $3, description = $4, configuration_version = $5, updated_at = now()
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id, owner_id, name, description, status, configuration_version, created_at, updated_at`,
        [ownerId, agentId, input.name ?? current.name, input.description ?? current.description, nextVersion],
      );
      const nextConfiguration = {
        instructions: input.instructions ?? current.instructions,
        tone: input.tone ?? current.tone,
        boundaries: input.boundaries ?? boundaries(current.boundaries),
        stylePreset: input.stylePreset ?? current.style_preset,
        responseLength: input.responseLength ?? current.response_length,
        signaturePhrases: input.signaturePhrases ?? boundaries(current.signature_phrases),
        prohibitedTopics: input.prohibitedTopics ?? boundaries(current.prohibited_topics),
        greeting: input.greeting ?? current.greeting,
      };
      await client.query(
        `INSERT INTO agent_configs (
           agent_id, owner_id, version, instructions, tone, boundaries,
           style_preset, response_length, signature_phrases, prohibited_topics, greeting
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10::jsonb, $11)`,
        [
          agentId,
          ownerId,
          nextVersion,
          nextConfiguration.instructions,
          nextConfiguration.tone,
          JSON.stringify(nextConfiguration.boundaries),
          nextConfiguration.stylePreset,
          nextConfiguration.responseLength,
          JSON.stringify(nextConfiguration.signaturePhrases),
          JSON.stringify(nextConfiguration.prohibitedTopics),
          nextConfiguration.greeting,
        ],
      );
      await client.query("COMMIT");
      return mapAgent({
        ...updatedResult.rows[0]!,
        instructions: nextConfiguration.instructions,
        tone: nextConfiguration.tone,
        boundaries: nextConfiguration.boundaries,
        style_preset: nextConfiguration.stylePreset,
        response_length: nextConfiguration.responseLength,
        signature_phrases: nextConfiguration.signaturePhrases,
        prohibited_topics: nextConfiguration.prohibitedTopics,
        greeting: nextConfiguration.greeting,
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listSources(ownerId: string, agentId: string) {
    await this.getAgent(ownerId, agentId);
    const result = await this.pool.query<SourceRow>(
      `SELECT id, owner_id, agent_id, title, type, status, visibility, created_at, updated_at
       FROM sources
       WHERE owner_id = $1 AND agent_id = $2 AND deleted_at IS NULL
       ORDER BY updated_at DESC, id`,
      [ownerId, agentId],
    );
    return result.rows.map(mapSource);
  }

  async createSource(ownerId: string, agentId: string, input: CreateSourceInput) {
    const result = await this.pool.query<SourceRow>(
      `INSERT INTO sources (
         id, owner_id, agent_id, title, type,
         storage_key, expected_content_type, expected_size, upload_expires_at
       )
       SELECT $1, $2, a.id, $4, $5, $6, $7, $8, $9
       FROM agents a
       WHERE a.owner_id = $2 AND a.id = $3 AND a.deleted_at IS NULL
       RETURNING id, owner_id, agent_id, title, type, status, visibility, created_at, updated_at`,
      [
        randomUUID(), ownerId, agentId, input.title, input.type,
        input.upload?.storageKey ?? null,
        input.upload?.contentType ?? null,
        input.upload?.size ?? null,
        input.upload?.expiresAt ?? null,
      ],
    );
    if (!result.rows[0]) throw new WorkspaceRecordNotFoundError("Agent not found.");
    return mapSource(result.rows[0]);
  }

  async updateSourceVisibility(
    ownerId: string,
    agentId: string,
    sourceId: string,
    visibility: SourceVisibility,
  ) {
    const result = await this.pool.query<SourceRow>(
      `UPDATE sources
       SET visibility = $4, updated_at = now()
       WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL
         AND ($4 <> 'public' OR status = 'ready')
       RETURNING id, owner_id, agent_id, title, type, status, visibility, created_at, updated_at`,
      [ownerId, agentId, sourceId, visibility],
    );
    if (!result.rows[0]) {
      const existing = await this.pool.query<{ status: SourceStatus }>(
        `SELECT status FROM sources
         WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [ownerId, agentId, sourceId],
      );
      if (!existing.rows[0]) throw new WorkspaceRecordNotFoundError("Source not found.");
      throw new WorkspaceStateConflictError("Only a ready source can become public.");
    }
    return mapSource(result.rows[0]);
  }

  async getSourceUpload(ownerId: string, agentId: string, sourceId: string) {
    const result = await this.pool.query<SourceRow>(
      `SELECT id, owner_id, agent_id, title, type, status, visibility, created_at, updated_at,
         storage_key, expected_content_type, expected_size, upload_expires_at
       FROM sources
       WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [ownerId, agentId, sourceId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceRecordNotFoundError("Source not found.");
    if (
      !row.storage_key || !row.expected_content_type || row.expected_size === null ||
      row.expected_size === undefined || !row.upload_expires_at
    ) throw new WorkspaceStateConflictError("This source has no authorized upload.");
    return {
      ...mapSource(row),
      storageKey: row.storage_key,
      expectedContentType: row.expected_content_type,
      expectedSize: Number(row.expected_size),
      uploadExpiresAt: iso(row.upload_expires_at),
    };
  }

  async markSourceUploaded(ownerId: string, agentId: string, sourceId: string) {
    return this.updateSourceStatus(ownerId, agentId, sourceId, "uploaded", "preview");
  }

  async markSourceFailed(ownerId: string, agentId: string, sourceId: string) {
    return this.updateSourceStatus(ownerId, agentId, sourceId, "failed", "disabled");
  }

  private async updateSourceStatus(
    ownerId: string,
    agentId: string,
    sourceId: string,
    status: SourceStatus,
    visibility: SourceVisibility,
  ) {
    const result = await this.pool.query<SourceRow>(
      `UPDATE sources
       SET status = $4, visibility = $5, updated_at = now()
       WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL
       RETURNING id, owner_id, agent_id, title, type, status, visibility, created_at, updated_at`,
      [ownerId, agentId, sourceId, status, visibility],
    );
    if (!result.rows[0]) throw new WorkspaceRecordNotFoundError("Source not found.");
    return mapSource(result.rows[0]);
  }

  async deleteSource(ownerId: string, agentId: string, sourceId: string) {
    const result = await this.pool.query<{ storage_key: string | null }>(
      `UPDATE sources
       SET status = 'deleting', visibility = 'disabled', deleted_at = now(), updated_at = now()
       WHERE owner_id = $1 AND agent_id = $2 AND id = $3 AND deleted_at IS NULL
       RETURNING storage_key`,
      [ownerId, agentId, sourceId],
    );
    if (!result.rows[0]) throw new WorkspaceRecordNotFoundError("Source not found.");
    return result.rows[0].storage_key ? { storageKey: result.rows[0].storage_key } : {};
  }
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original transaction failure is more useful than a rollback failure.
  }
}
