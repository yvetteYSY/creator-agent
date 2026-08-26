import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresCreatorRepository } from "../src/creator-store";
import {
  PostgresWorkspaceRepository,
  WorkspaceRecordNotFoundError,
  WorkspaceStateConflictError,
} from "../src/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

suite("PostgreSQL creator workspace integration", () => {
  beforeAll(async () => {
    for (const migration of [
      "001_creator_identities.sql",
      "002_creator_workspace.sql",
      "003_agent_customization.sql",
      "004_private_uploads.sql",
    ]) {
      const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
      await pool!.query(sql);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("persists versioned configuration and enforces owner scope in real SQL", async () => {
    const creators = new PostgresCreatorRepository(pool!);
    const workspace = new PostgresWorkspaceRepository(pool!);
    const ownerA = await creators.upsertIdentity({
      issuer: "https://integration.example/",
      subject: "auth0|postgres-a",
      scopes: new Set(["read:creator", "write:agent"]),
    });
    const ownerB = await creators.upsertIdentity({
      issuer: "https://integration.example/",
      subject: "auth0|postgres-b",
      scopes: new Set(["read:creator", "write:agent"]),
    });
    const agent = await workspace.createAgent(ownerA.id, {
      name: "Integration agent",
      description: "Real PostgreSQL verification",
      instructions: "Use approved sources.",
      tone: "Warm",
      boundaries: ["Stay grounded"],
      stylePreset: "warm",
      responseLength: "balanced",
      signaturePhrases: ["Start small."],
      prohibitedTopics: ["Private data"],
      greeting: "What are you building?",
    });
    const updated = await workspace.updateAgent(ownerA.id, agent.id, {
      tone: "Direct",
      stylePreset: "direct",
    });
    expect(updated.configurationVersion).toBe(2);
    expect(updated.configuration).toMatchObject({
      tone: "Direct",
      stylePreset: "direct",
      signaturePhrases: ["Start small."],
    });
    await expect(workspace.getAgent(ownerB.id, agent.id))
      .rejects.toThrowError(WorkspaceRecordNotFoundError);

    const source = await workspace.createSource(ownerA.id, agent.id, {
      title: "Integration video",
      type: "video",
      upload: {
        storageKey: "private-uploads/postgres-integration",
        contentType: "video/mp4",
        size: 42,
        expiresAt: "2026-08-25T12:00:00.000Z",
      },
    });
    expect(source).toMatchObject({ status: "awaiting_upload", visibility: "preview" });
    expect(await workspace.getSourceUpload(ownerA.id, agent.id, source.id)).toMatchObject({
      storageKey: "private-uploads/postgres-integration",
      expectedContentType: "video/mp4",
      expectedSize: 42,
    });
    expect(await workspace.markSourceUploaded(ownerA.id, agent.id, source.id))
      .toMatchObject({ status: "uploaded", visibility: "preview" });
    await expect(workspace.updateSourceVisibility(ownerA.id, agent.id, source.id, "public"))
      .rejects.toThrowError(WorkspaceStateConflictError);
    await expect(workspace.updateSourceVisibility(ownerB.id, agent.id, source.id, "disabled"))
      .rejects.toThrowError(WorkspaceRecordNotFoundError);
    await expect(workspace.deleteSource(ownerA.id, agent.id, source.id))
      .resolves.toEqual({ storageKey: "private-uploads/postgres-integration" });
    expect(await workspace.listSources(ownerA.id, agent.id)).toEqual([]);
  });
});
