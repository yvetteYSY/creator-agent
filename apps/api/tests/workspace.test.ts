import { describe, expect, it, vi } from "vitest";
import type { AccessTokenVerifier, AuthenticatedPrincipal } from "../src/auth";
import type { CreatorRecord, CreatorRepository } from "../src/creator-store";
import { handleApiRequest, type ApiDependencies } from "../src/handler";
import {
  PostgresWorkspaceRepository,
  WorkspaceRecordNotFoundError,
  WorkspaceStateConflictError,
  type AgentRecord,
  type CreateAgentInput,
  type CreateSourceInput,
  type SourceRecord,
  type SourceVisibility,
  type UpdateAgentInput,
  type WorkspaceRepository,
} from "../src/workspace-store";

const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-08-25T00:00:00.000Z";

class MemoryCreators implements CreatorRepository {
  private readonly records = new Map<string, CreatorRecord>();

  async upsertIdentity(principal: AuthenticatedPrincipal) {
    const key = `${principal.issuer}\u0000${principal.subject}`;
    let record = this.records.get(key);
    if (!record) {
      record = {
        id: `creator-${this.records.size + 1}`,
        issuer: principal.issuer,
        subject: principal.subject,
        createdAt: NOW,
        lastSeenAt: NOW,
      };
      this.records.set(key, record);
    }
    return record;
  }
}

class MemoryWorkspace implements WorkspaceRepository {
  readonly agents = new Map<string, AgentRecord>();
  readonly sources = new Map<string, SourceRecord>();

  async listAgents(ownerId: string) {
    return [...this.agents.values()].filter((agent) => agent.ownerId === ownerId);
  }

  async getAgent(ownerId: string, agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.ownerId !== ownerId) throw new WorkspaceRecordNotFoundError();
    return agent;
  }

  async createAgent(ownerId: string, input: CreateAgentInput) {
    const record: AgentRecord = {
      id: AGENT_A,
      ownerId,
      name: input.name,
      description: input.description,
      status: "draft",
      configurationVersion: 1,
      configuration: {
        instructions: input.instructions,
        tone: input.tone,
        boundaries: input.boundaries,
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.agents.set(record.id, record);
    return record;
  }

  async updateAgent(ownerId: string, agentId: string, input: UpdateAgentInput) {
    const current = await this.getAgent(ownerId, agentId);
    const record: AgentRecord = {
      ...current,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      configurationVersion: current.configurationVersion + 1,
      configuration: {
        instructions: input.instructions ?? current.configuration.instructions,
        tone: input.tone ?? current.configuration.tone,
        boundaries: input.boundaries ?? current.configuration.boundaries,
      },
    };
    this.agents.set(agentId, record);
    return record;
  }

  async listSources(ownerId: string, agentId: string) {
    await this.getAgent(ownerId, agentId);
    return [...this.sources.values()].filter(
      (source) => source.ownerId === ownerId && source.agentId === agentId,
    );
  }

  async createSource(ownerId: string, agentId: string, input: CreateSourceInput) {
    await this.getAgent(ownerId, agentId);
    const record: SourceRecord = {
      id: SOURCE_A,
      ownerId,
      agentId,
      title: input.title,
      type: input.type,
      status: "awaiting_upload",
      visibility: "preview",
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.sources.set(record.id, record);
    return record;
  }

  async updateSourceVisibility(
    ownerId: string,
    agentId: string,
    sourceId: string,
    visibility: SourceVisibility,
  ) {
    const source = this.sources.get(sourceId);
    if (!source || source.ownerId !== ownerId || source.agentId !== agentId) {
      throw new WorkspaceRecordNotFoundError();
    }
    if (visibility === "public" && source.status !== "ready") {
      throw new WorkspaceStateConflictError("Only a ready source can become public.");
    }
    const record = { ...source, visibility };
    this.sources.set(sourceId, record);
    return record;
  }
}

function principal(subject: string, scopes = ["read:creator", "write:agent"]): AuthenticatedPrincipal {
  return { issuer: "https://tenant.example/", subject, scopes: new Set(scopes) };
}

function dependencies(
  subject: string,
  creators: MemoryCreators,
  workspace: MemoryWorkspace,
  scopes?: string[],
): ApiDependencies {
  const verifier: AccessTokenVerifier = { verify: vi.fn(async () => principal(subject, scopes)) };
  return { verifier, creators, workspace };
}

function request(method: string, path: string, body?: unknown) {
  return { method, path, body, authorization: "Bearer verified-token" };
}

describe("durable creator workspace API", () => {
  it("creates, lists, reads, and versions an agent without exposing its owner key", async () => {
    const creators = new MemoryCreators();
    const workspace = new MemoryWorkspace();
    const deps = dependencies("auth0|creator-a", creators, workspace);
    const created = await handleApiRequest(request("POST", "/v1/agents", {
      name: "Ari's Creative Coach",
      description: "Practical guidance",
      instructions: "Use approved sources.",
      tone: "Warm and direct",
      boundaries: ["No financial advice", "No financial advice"],
    }), deps);
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("ownerId");
    expect(created.body).toMatchObject({
      agent: {
        id: AGENT_A,
        status: "draft",
        configurationVersion: 1,
        configuration: { boundaries: ["No financial advice"] },
      },
    });

    const updated = await handleApiRequest(request("PATCH", `/v1/agents/${AGENT_A}`, {
      tone: "Concise and candid",
    }), deps);
    expect(updated.body).toMatchObject({
      agent: {
        name: "Ari's Creative Coach",
        configurationVersion: 2,
        configuration: { tone: "Concise and candid", instructions: "Use approved sources." },
      },
    });
    expect((await handleApiRequest(request("GET", "/v1/agents"), deps)).body)
      .toMatchObject({ agents: [{ id: AGENT_A }] });
    expect((await handleApiRequest(request("GET", `/v1/agents/${AGENT_A}`), deps)).status).toBe(200);
  });

  it("creates source metadata as private preview state and updates visibility", async () => {
    const creators = new MemoryCreators();
    const workspace = new MemoryWorkspace();
    const deps = dependencies("auth0|creator-a", creators, workspace);
    await handleApiRequest(request("POST", "/v1/agents", {
      name: "Coach",
      boundaries: [],
    }), deps);
    const created = await handleApiRequest(request("POST", `/v1/agents/${AGENT_A}/sources`, {
      title: "Private workshop.mp4",
      type: "video",
    }), deps);
    expect(created.body).toMatchObject({
      source: {
        id: SOURCE_A,
        agentId: AGENT_A,
        status: "awaiting_upload",
        visibility: "preview",
      },
    });
    expect(JSON.stringify(created.body)).not.toContain("ownerId");
    const updated = await handleApiRequest(request(
      "PATCH",
      `/v1/agents/${AGENT_A}/sources/${SOURCE_A}`,
      { visibility: "disabled" },
    ), deps);
    expect(updated.body).toMatchObject({ source: { visibility: "disabled" } });
    expect(await handleApiRequest(request(
      "PATCH",
      `/v1/agents/${AGENT_A}/sources/${SOURCE_A}`,
      { visibility: "public" },
    ), deps)).toEqual({
      status: 409,
      body: { error: "Only a ready source can become public." },
    });
  });

  it("returns the same generic 404 for another creator's agent and source", async () => {
    const creators = new MemoryCreators();
    const workspace = new MemoryWorkspace();
    const creatorA = dependencies("auth0|creator-a", creators, workspace);
    const creatorB = dependencies("auth0|creator-b", creators, workspace);
    await handleApiRequest(request("POST", "/v1/agents", { name: "Private agent", boundaries: [] }), creatorA);
    await handleApiRequest(request("POST", `/v1/agents/${AGENT_A}/sources`, {
      title: "Private source",
      type: "document",
    }), creatorA);

    for (const response of [
      await handleApiRequest(request("GET", `/v1/agents/${AGENT_A}`), creatorB),
      await handleApiRequest(request("PATCH", `/v1/agents/${AGENT_A}`, { name: "Hijacked" }), creatorB),
      await handleApiRequest(request("GET", `/v1/agents/${AGENT_A}/sources`), creatorB),
      await handleApiRequest(request("PATCH", `/v1/agents/${AGENT_A}/sources/${SOURCE_A}`, { visibility: "public" }), creatorB),
    ]) {
      expect(response).toEqual({ status: 404, body: { error: "Not found." } });
    }
    expect(workspace.agents.get(AGENT_A)?.name).toBe("Private agent");
    expect(workspace.sources.get(SOURCE_A)?.visibility).toBe("preview");
  });

  it("requires write permission and rejects unknown, oversized, or invalid fields", async () => {
    const creators = new MemoryCreators();
    const workspace = new MemoryWorkspace();
    const readOnly = dependencies("auth0|creator-a", creators, workspace, ["read:creator"]);
    expect(await handleApiRequest(request("POST", "/v1/agents", {
      name: "Forbidden",
      boundaries: [],
    }), readOnly)).toEqual({ status: 403, body: { error: "Forbidden." } });
    expect(workspace.agents.size).toBe(0);

    const writable = dependencies("auth0|creator-a", creators, workspace);
    for (const body of [
      { name: "", boundaries: [] },
      { name: "Valid", ownerId: "creator-attacker", boundaries: [] },
      { name: "Valid", boundaries: Array.from({ length: 21 }, () => "boundary") },
    ]) {
      expect((await handleApiRequest(request("POST", "/v1/agents", body), writable)).status).toBe(400);
    }
    expect(workspace.agents.size).toBe(0);
  });

  it("uses owner-scoped parameters in PostgreSQL reads and source mutations", async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => ({
      rows: sql.startsWith("UPDATE sources") ? [{
        id: SOURCE_A,
        owner_id: "creator-internal",
        agent_id: AGENT_A,
        title: "Source",
        type: "document",
        status: "awaiting_upload",
        visibility: "disabled",
        created_at: NOW,
        updated_at: NOW,
      }] : [],
    }));
    const repository = new PostgresWorkspaceRepository({ query } as never);
    await repository.listAgents("creator-internal");
    await repository.updateSourceVisibility(
      "creator-internal",
      AGENT_A,
      SOURCE_A,
      "disabled",
    );
    expect(query.mock.calls[0][0]).toContain("a.owner_id = $1");
    expect(query.mock.calls[0][1]).toEqual(["creator-internal"]);
    expect(query.mock.calls[1][0]).toContain("WHERE owner_id = $1 AND agent_id = $2 AND id = $3");
    expect(query.mock.calls[1][1]).toEqual(["creator-internal", AGENT_A, SOURCE_A, "disabled"]);
  });
});
