import { randomUUID } from "node:crypto";

export interface AuditEventInput {
  actor: { type: "creator"; id: string } | { type: "system" };
  action: string;
  targetType: "source";
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export async function recordAuditEvent(queryable: Queryable, event: AuditEventInput) {
  const metadata = safeMetadata(event.metadata ?? {});
  await queryable.query(
    `INSERT INTO audit_events (
       id, actor_type, actor_id, action, target_type, target_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      randomUUID(),
      event.actor.type,
      event.actor.type === "creator" ? event.actor.id : null,
      event.action,
      event.targetType,
      event.targetId,
      JSON.stringify(metadata),
    ],
  );
}

function safeMetadata(metadata: Record<string, string | number | boolean | null>) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "type") {
      if (value !== "document" && value !== "audio" && value !== "video") invalidMetadata();
    } else if (key === "status") {
      if (
        value !== "awaiting_upload" && value !== "uploaded" && value !== "scanning" &&
        value !== "processing" && value !== "failed" && value !== "deleting"
      ) invalidMetadata();
    } else if (key === "visibility") {
      if (value !== "preview" && value !== "disabled") invalidMetadata();
    } else if (key === "hasStoredObject") {
      if (typeof value !== "boolean") invalidMetadata();
    } else if (key === "attempt") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) invalidMetadata();
    } else if (key === "failureCode") {
      if (value !== null && (typeof value !== "string" || !/^[a-z0-9_]{1,80}$/.test(value))) invalidMetadata();
    } else {
      invalidMetadata();
    }
    safe[key] = value;
  }
  return safe;
}

function invalidMetadata(): never {
  throw new Error("Audit metadata contains a forbidden field or value.");
}
