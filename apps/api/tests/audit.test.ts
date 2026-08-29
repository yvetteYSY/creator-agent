import { describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "../src/audit";

describe("content-free audit writer", () => {
  it("stores only the explicitly supplied opaque lifecycle fields", async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({ rows: [] }));
    await recordAuditEvent({ query }, {
      actor: { type: "creator", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      action: "source.upload_authorized",
      targetType: "source",
      targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      metadata: { type: "video", status: "awaiting_upload", visibility: "preview" },
    });
    const parameters = query.mock.calls[0][1];
    expect(parameters).toHaveLength(7);
    expect(parameters).toContain("source.upload_authorized");
    expect(parameters).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const serialized = JSON.stringify(parameters);
    expect(serialized).not.toContain(".mp4");
    expect(serialized).not.toContain("private-uploads/");
    expect(serialized).not.toContain("http");
  });

  it("rejects content-bearing or unbounded metadata before writing", async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({ rows: [] }));
    await expect(recordAuditEvent({ query }, {
      actor: { type: "system" },
      action: "source.scan_failed",
      targetType: "source",
      targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      metadata: { fileName: "private-video.mp4" },
    })).rejects.toThrowError(/forbidden field or value/i);
    await expect(recordAuditEvent({ query }, {
      actor: { type: "system" },
      action: "source.scan_failed",
      targetType: "source",
      targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      metadata: { failureCode: "https://storage.example/private-object" },
    })).rejects.toThrowError(/forbidden field or value/i);
    expect(query).not.toHaveBeenCalled();
  });
});
