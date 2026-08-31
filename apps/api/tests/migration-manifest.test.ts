import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/migration-manifest";

describe("database migration manifest", () => {
  it("includes every ordered migration exactly once", () => {
    expect(MIGRATIONS).toEqual([
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
    ]);
    expect(new Set(MIGRATIONS).size).toBe(MIGRATIONS.length);
  });
});
