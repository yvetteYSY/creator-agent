import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresCreatorRepository } from "../src/creator-store";
import { PostgresStorageDeletionRepository } from "../src/cleanup-store";
import { PostgresScanRepository } from "../src/scanner-store";
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
      "005_quarantine_scanning.sql",
      "006_storage_deletion_reconciliation.sql",
      "007_ingestion_audit_events.sql",
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
    const scanner = new PostgresScanRepository(pool!);
    const scanJob = await scanner.claimNext({
      staleBefore: new Date("2026-08-25T00:00:00.000Z"),
      maxAttempts: 3,
    });
    expect(scanJob).toMatchObject({
      sourceId: source.id,
      storageKey: "private-uploads/postgres-integration",
      attempt: 1,
    });
    await expect(scanner.claimNext({
      staleBefore: new Date("2026-08-25T00:00:00.000Z"),
      maxAttempts: 3,
    })).resolves.toBeNull();
    await expect(scanner.complete({
      ...scanJob!,
      leaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }, "video/mp4")).resolves.toBe(false);
    await expect(scanner.complete(scanJob!, "video/mp4")).resolves.toBe(true);
    expect(await workspace.listSources(ownerA.id, agent.id))
      .toContainEqual(expect.objectContaining({ id: source.id, status: "processing", visibility: "preview" }));
    await expect(workspace.updateSourceVisibility(ownerA.id, agent.id, source.id, "public"))
      .rejects.toThrowError(WorkspaceStateConflictError);
    await expect(workspace.updateSourceVisibility(ownerB.id, agent.id, source.id, "disabled"))
      .rejects.toThrowError(WorkspaceRecordNotFoundError);
    await expect(workspace.deleteSource(ownerA.id, agent.id, source.id))
      .resolves.toEqual({ storageKey: "private-uploads/postgres-integration" });
    const cleanup = new PostgresStorageDeletionRepository(pool!);
    const deletionJob = await cleanup.claimNext({
      staleBefore: new Date("2026-08-25T00:00:00.000Z"),
      maxAttempts: 100,
    });
    expect(deletionJob).toMatchObject({
      sourceId: source.id,
      storageKey: "private-uploads/postgres-integration",
      attempt: 1,
    });
    await expect(cleanup.claimNext({
      staleBefore: new Date("2026-08-25T00:00:00.000Z"),
      maxAttempts: 100,
    })).resolves.toBeNull();
    await expect(cleanup.complete({
      ...deletionJob!,
      leaseId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    })).resolves.toBe(false);
    await expect(cleanup.complete(deletionJob!)).resolves.toBe(true);

    const scanningSource = await workspace.createSource(ownerA.id, agent.id, {
      title: "Delete during scan",
      type: "video",
      upload: {
        storageKey: "private-uploads/delete-during-scan",
        contentType: "video/mp4",
        size: 24,
        expiresAt: "2026-08-25T12:00:00.000Z",
      },
    });
    await workspace.markSourceUploaded(ownerA.id, agent.id, scanningSource.id);
    const cancelledScan = await scanner.claimNext({
      staleBefore: new Date("2026-08-25T00:00:00.000Z"),
      maxAttempts: 3,
    });
    expect(cancelledScan?.sourceId).toBe(scanningSource.id);
    await expect(workspace.deleteSource(ownerA.id, agent.id, scanningSource.id))
      .resolves.toEqual({ storageKey: "private-uploads/delete-during-scan" });
    await expect(scanner.complete(cancelledScan!, "video/mp4")).resolves.toBe(false);
    const cancelledCleanup = await cleanup.claimNext({
      staleBefore: new Date("2026-08-25T00:00:00.000Z"),
      maxAttempts: 100,
    });
    expect(cancelledCleanup?.sourceId).toBe(scanningSource.id);
    await expect(cleanup.complete(cancelledCleanup!)).resolves.toBe(true);
    expect(await workspace.listSources(ownerA.id, agent.id)).toEqual([]);

    const audit = await pool!.query<{
      actor_type: string;
      actor_id: string | null;
      action: string;
      target_id: string;
      metadata: unknown;
    }>(`SELECT actor_type, actor_id, action, target_id, metadata
        FROM audit_events ORDER BY occurred_at, id`);
    expect(audit.rows.map((event) => event.action)).toEqual(expect.arrayContaining([
      "source.upload_authorized",
      "source.upload_completed",
      "source.scan_claimed",
      "source.scan_passed",
      "source.deleted",
      "source.storage_deletion_claimed",
      "source.storage_deletion_completed",
    ]));
    expect(audit.rows.some((event) => event.actor_type === "creator" && event.actor_id === ownerA.id))
      .toBe(true);
    expect(audit.rows.some((event) => event.actor_type === "system" && event.actor_id === null))
      .toBe(true);
    const serializedAudit = JSON.stringify(audit.rows);
    expect(serializedAudit).not.toContain("Integration video");
    expect(serializedAudit).not.toContain("delete-during-scan");
    expect(serializedAudit).not.toContain("private-uploads/");
    expect(serializedAudit).not.toContain("auth0|postgres-a");
    await expect(pool!.query("UPDATE audit_events SET action = 'tampered'"))
      .rejects.toThrowError(/immutable/i);
    await expect(pool!.query("DELETE FROM audit_events"))
      .rejects.toThrowError(/immutable/i);
  });
});
