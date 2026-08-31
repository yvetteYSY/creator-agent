import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresCreatorRepository } from "../src/creator-store";
import { PostgresStorageDeletionRepository } from "../src/cleanup-store";
import { PostgresScanRepository } from "../src/scanner-store";
import { PostgresTranscriptRepository } from "../src/transcript-store";
import { PostgresGitHubIntegrationRepository } from "../src/github-store";
import {
  PostgresWorkspaceRepository,
  WorkspaceRecordNotFoundError,
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
      "008_media_inspection.sql",
      "009_malware_scanning.sql",
      "010_creator_transcripts.sql",
      "011_github_app_integrations.sql",
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

    const github = new PostgresGitHubIntegrationRepository(pool!);
    const stateDigest = "a".repeat(64);
    await github.beginConnection(ownerA.id, stateDigest, new Date(Date.now() + 60_000).toISOString());
    await github.completeConnection(stateDigest, {
      id: 42,
      accountLogin: "yvetteYSY",
      accountType: "User",
      repositorySelection: "selected",
      suspended: false,
    });
    const imported = await github.importTextSource(ownerA.id, agent.id, {
      installationId: 42,
      title: "Private repository guide",
      repositoryOwner: "yvetteYSY",
      repositoryName: "creator-agent",
      path: "README.md",
      file: {
        content: "Private imported content must be erased on deletion.",
        sha: "abc123",
        htmlUrl: "https://github.com/yvetteYSY/creator-agent/blob/main/README.md",
        size: 52,
      },
    });
    expect(imported.source).toMatchObject({ status: "ready", visibility: "preview" });
    await workspace.deleteSource(ownerA.id, agent.id, imported.source.id);
    const erasedImport = await pool!.query(
      "SELECT count(*)::integer AS count FROM github_source_imports WHERE source_id = $1",
      [imported.source.id],
    );
    expect(erasedImport.rows[0]?.count).toBe(0);

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
    }, {
      mediaType: "video/mp4",
      durationMs: 182_200,
      videoCodec: "avc1",
      audioCodec: "mp4a",
    }, { status: "clean", scanner: "clamav" })).resolves.toBe(false);
    await expect(scanner.complete(scanJob!, {
      mediaType: "video/mp4",
      durationMs: 182_200,
      videoCodec: "avc1",
      audioCodec: "mp4a",
    }, { status: "clean", scanner: "clamav" })).resolves.toBe(true);
    const inspected = await pool!.query(
      `SELECT detected_media_type, detected_duration_ms, detected_video_codec, detected_audio_codec,
         malware_scan_status, malware_scanner, malware_scanned_at
       FROM sources WHERE id = $1`,
      [source.id],
    );
    expect(inspected.rows[0]).toMatchObject({
      detected_media_type: "video/mp4",
      detected_duration_ms: "182200",
      detected_video_codec: "avc1",
      detected_audio_codec: "mp4a",
      malware_scan_status: "clean",
      malware_scanner: "clamav",
    });
    expect(inspected.rows[0].malware_scanned_at).toBeInstanceOf(Date);
    expect(await workspace.listSources(ownerA.id, agent.id))
      .toContainEqual(expect.objectContaining({ id: source.id, status: "processing", visibility: "preview" }));
    const transcripts = new PostgresTranscriptRepository(pool!);
    const webvtt = "WEBVTT\n\n00:00.000 --> 00:02.000\nFirst private caption.";
    await expect(transcripts.saveDraft(ownerA.id, agent.id, source.id, webvtt))
      .resolves.toMatchObject({ status: "draft", version: 1, cueCount: 1, durationMs: 2_000 });
    await expect(transcripts.get(ownerB.id, agent.id, source.id))
      .rejects.toThrowError(WorkspaceRecordNotFoundError);
    await expect(transcripts.review(ownerA.id, agent.id, source.id, "approved"))
      .resolves.toMatchObject({ status: "approved", version: 1 });
    await expect(workspace.updateSourceVisibility(ownerA.id, agent.id, source.id, "public"))
      .resolves.toMatchObject({ status: "ready", visibility: "public" });
    await expect(transcripts.saveDraft(
      ownerA.id,
      agent.id,
      source.id,
      "WEBVTT\n\n00:01.000 --> 00:03.000\nReplacement private caption.",
    )).resolves.toMatchObject({ status: "draft", version: 2 });
    expect(await workspace.listSources(ownerA.id, agent.id))
      .toContainEqual(expect.objectContaining({ id: source.id, status: "processing", visibility: "preview" }));
    await expect(transcripts.review(ownerA.id, agent.id, source.id, "rejected"))
      .resolves.toMatchObject({ status: "rejected", version: 2 });
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
    const deletedTranscript = await pool!.query(
      "SELECT webvtt, cue_count, duration_ms, deleted_at FROM source_transcripts WHERE source_id = $1",
      [source.id],
    );
    expect(deletedTranscript.rows[0]).toMatchObject({ webvtt: "", cue_count: 0, duration_ms: "0" });
    expect(deletedTranscript.rows[0].deleted_at).toBeInstanceOf(Date);

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
    await expect(scanner.complete(cancelledScan!, {
      mediaType: "video/mp4",
      durationMs: 182_200,
      videoCodec: "avc1",
      audioCodec: "mp4a",
    }, { status: "clean", scanner: "clamav" })).resolves.toBe(false);
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
      "source.transcript_saved",
      "source.transcript_approved",
      "source.transcript_rejected",
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
    expect(serializedAudit).not.toContain("First private caption");
    expect(serializedAudit).not.toContain("Replacement private caption");
    await expect(pool!.query("UPDATE audit_events SET action = 'tampered'"))
      .rejects.toThrowError(/immutable/i);
    await expect(pool!.query("DELETE FROM audit_events"))
      .rejects.toThrowError(/immutable/i);
  });
});
