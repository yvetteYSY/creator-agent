import { randomUUID } from "node:crypto";
import {
  AuthenticationError,
  readBearerToken,
  type AccessTokenVerifier,
} from "./auth";
import { CreatorAccessRevokedError, type CreatorRecord, type CreatorRepository } from "./creator-store";
import {
  WorkspaceRecordNotFoundError,
  WorkspaceStateConflictError,
  type AgentRecord,
  type CreateAgentInput,
  type CreateSourceInput,
  type SourceRecord,
  type SourceType,
  type SourceVisibility,
  type UpdateAgentInput,
  type WorkspaceRepository,
} from "./workspace-store";
import {
  ObjectStorageUnavailableError,
  StoredObjectNotFoundError,
  type ObjectStorage,
} from "./object-storage";

export interface ApiRequest {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDependencies {
  verifier: AccessTokenVerifier;
  creators: CreatorRepository;
  workspace: WorkspaceRepository;
  storage?: ObjectStorage;
}

class RequestValidationError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_ITEM_PATTERN = /^\/v1\/agents\/([^/]+)$/;
const SOURCE_COLLECTION_PATTERN = /^\/v1\/agents\/([^/]+)\/sources$/;
const SOURCE_ITEM_PATTERN = /^\/v1\/agents\/([^/]+)\/sources\/([^/]+)$/;
const SOURCE_UPLOAD_PATTERN = /^\/v1\/agents\/([^/]+)\/sources\/uploads$/;
const SOURCE_COMPLETE_PATTERN = /^\/v1\/agents\/([^/]+)\/sources\/([^/]+)\/complete$/;

export async function handleApiRequest(
  request: ApiRequest,
  dependencies: ApiDependencies,
): Promise<ApiResponse> {
  if (request.method === "GET" && request.path === "/health") {
    return { status: 200, body: { ok: true, service: "creator-agent-api", aiCalls: 0 } };
  }

  try {
    if (request.method === "GET" && request.path === "/v1/me") {
      const creator = await authorize(request, dependencies, "read:creator");
      return { status: 200, body: { creator: publicCreator(creator) } };
    }

    if (request.path === "/v1/agents" && request.method === "GET") {
      const creator = await authorize(request, dependencies, "read:creator");
      const agents = await dependencies.workspace.listAgents(creator.id);
      return { status: 200, body: { agents: agents.map(publicAgent) } };
    }
    if (request.path === "/v1/agents" && request.method === "POST") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agent = await dependencies.workspace.createAgent(creator.id, parseCreateAgent(request.body));
      return { status: 201, body: { agent: publicAgent(agent) } };
    }

    const sourceComplete = SOURCE_COMPLETE_PATTERN.exec(request.path);
    if (sourceComplete && request.method === "POST") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agentId = resourceId(sourceComplete[1], "agent ID");
      const sourceId = resourceId(sourceComplete[2], "source ID");
      const storage = availableStorage(dependencies.storage);
      const upload = await dependencies.workspace.getSourceUpload(creator.id, agentId, sourceId);
      if (upload.status !== "awaiting_upload") {
        if (upload.status === "uploaded" || upload.status === "scanning" || upload.status === "processing") {
          return { status: 200, body: { source: publicSource(upload) } };
        }
        throw new WorkspaceStateConflictError("This video upload can no longer be completed.");
      }
      let object;
      try {
        object = await storage.inspectObject(upload.storageKey);
      } catch (error) {
        if (error instanceof StoredObjectNotFoundError) {
          throw new WorkspaceStateConflictError("The authorized video upload was not found.");
        }
        throw error;
      }
      if (object.size !== upload.expectedSize || object.contentType !== upload.expectedContentType) {
        await storage.deleteObject(upload.storageKey);
        await dependencies.workspace.markSourceFailed(creator.id, agentId, sourceId);
        throw new WorkspaceStateConflictError("The uploaded video did not match its authorized size and content type.");
      }
      const source = await dependencies.workspace.markSourceUploaded(creator.id, agentId, sourceId);
      return { status: 200, body: { source: publicSource(source) } };
    }

    const sourceUpload = SOURCE_UPLOAD_PATTERN.exec(request.path);
    if (sourceUpload && request.method === "POST") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agentId = resourceId(sourceUpload[1], "agent ID");
      const input = parseVideoUpload(request.body);
      const storage = availableStorage(dependencies.storage);
      const storageKey = `private-uploads/${randomUUID()}`;
      const policy = await storage.createUpload({
        key: storageKey,
        contentType: input.contentType,
        exactSize: input.size,
        expiresInSeconds: 600,
      });
      const source = await dependencies.workspace.createSource(creator.id, agentId, {
        title: input.title,
        type: "video",
        upload: {
          storageKey,
          contentType: input.contentType,
          size: input.size,
          expiresAt: policy.expiresAt,
        },
      });
      return {
        status: 201,
        body: {
          source: publicSource(source),
          upload: policy,
        },
      };
    }

    const sourceItem = SOURCE_ITEM_PATTERN.exec(request.path);
    if (sourceItem && request.method === "DELETE") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agentId = resourceId(sourceItem[1], "agent ID");
      const sourceId = resourceId(sourceItem[2], "source ID");
      const deleted = await dependencies.workspace.deleteSource(creator.id, agentId, sourceId);
      if (deleted.storageKey) await availableStorage(dependencies.storage).deleteObject(deleted.storageKey);
      return { status: 200, body: { deleted: true } };
    }
    if (sourceItem && request.method === "PATCH") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agentId = resourceId(sourceItem[1], "agent ID");
      const sourceId = resourceId(sourceItem[2], "source ID");
      const visibility = parseVisibility(request.body);
      const source = await dependencies.workspace.updateSourceVisibility(
        creator.id,
        agentId,
        sourceId,
        visibility,
      );
      return { status: 200, body: { source: publicSource(source) } };
    }

    const sourceCollection = SOURCE_COLLECTION_PATTERN.exec(request.path);
    if (sourceCollection && request.method === "GET") {
      const creator = await authorize(request, dependencies, "read:creator");
      const agentId = resourceId(sourceCollection[1], "agent ID");
      const sources = await dependencies.workspace.listSources(creator.id, agentId);
      return { status: 200, body: { sources: sources.map(publicSource) } };
    }
    if (sourceCollection && request.method === "POST") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agentId = resourceId(sourceCollection[1], "agent ID");
      const source = await dependencies.workspace.createSource(
        creator.id,
        agentId,
        parseCreateSource(request.body),
      );
      return { status: 201, body: { source: publicSource(source) } };
    }

    const agentItem = AGENT_ITEM_PATTERN.exec(request.path);
    if (agentItem && request.method === "GET") {
      const creator = await authorize(request, dependencies, "read:creator");
      const agent = await dependencies.workspace.getAgent(
        creator.id,
        resourceId(agentItem[1], "agent ID"),
      );
      return { status: 200, body: { agent: publicAgent(agent) } };
    }
    if (agentItem && request.method === "PATCH") {
      const creator = await authorize(request, dependencies, "write:agent");
      const agent = await dependencies.workspace.updateAgent(
        creator.id,
        resourceId(agentItem[1], "agent ID"),
        parseUpdateAgent(request.body),
      );
      return { status: 200, body: { agent: publicAgent(agent) } };
    }

    return { status: 404, body: { error: "Not found." } };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: 401, body: { error: "Unauthorized." } };
    }
    if (error instanceof CreatorAccessRevokedError) {
      return { status: 403, body: { error: "Forbidden." } };
    }
    if (error instanceof RequestValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    if (error instanceof WorkspaceRecordNotFoundError) {
      return { status: 404, body: { error: "Not found." } };
    }
    if (error instanceof WorkspaceStateConflictError) {
      return { status: 409, body: { error: error.message } };
    }
    if (error instanceof ObjectStorageUnavailableError) {
      return { status: 503, body: { error: "Private upload storage is unavailable." } };
    }
    throw error;
  }
}

async function authorize(
  request: ApiRequest,
  dependencies: ApiDependencies,
  requiredScope: "read:creator" | "write:agent",
) {
  const accessToken = readBearerToken(request.authorization);
  const principal = await dependencies.verifier.verify(accessToken);
  if (!principal.scopes.has(requiredScope)) {
    throw new CreatorAccessRevokedError("The access token lacks permission.");
  }
  return dependencies.creators.upsertIdentity(principal);
}

function objectBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestValidationError("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function text(
  body: Record<string, unknown>,
  field: string,
  maximum: number,
  options: { required?: boolean; defaultValue?: string } = {},
) {
  const value = body[field];
  if (value === undefined && options.defaultValue !== undefined) return options.defaultValue;
  if (value === undefined && !options.required) return undefined;
  if (typeof value !== "string") throw new RequestValidationError(`${field} must be a string.`);
  const cleaned = value.trim();
  if (!cleaned && options.required) throw new RequestValidationError(`${field} is required.`);
  if (cleaned.length > maximum) throw new RequestValidationError(`${field} must be at most ${maximum} characters.`);
  return cleaned;
}

function boundaryList(body: Record<string, unknown>, required: boolean) {
  const value = body.boundaries;
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new RequestValidationError("boundaries must be an array with at most 20 items.");
  }
  const cleaned = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 200) {
      throw new RequestValidationError("Each boundary must be a non-empty string of at most 200 characters.");
    }
    return item.trim();
  });
  return [...new Set(cleaned)];
}

function stringList(
  body: Record<string, unknown>,
  field: string,
  options: { required: boolean; maximumItems: number; maximumLength: number },
) {
  const value = body[field];
  if (value === undefined && !options.required) return undefined;
  if (!Array.isArray(value) || value.length > options.maximumItems) {
    throw new RequestValidationError(`${field} must be an array with at most ${options.maximumItems} items.`);
  }
  const cleaned = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > options.maximumLength) {
      throw new RequestValidationError(`Each ${field} item must be a non-empty string of at most ${options.maximumLength} characters.`);
    }
    return item.trim();
  });
  return [...new Set(cleaned)];
}

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new RequestValidationError(`Unknown field: ${unknown}.`);
}

function parseCreateAgent(body: unknown): CreateAgentInput {
  const input = objectBody(body);
  rejectUnknown(input, [
    "name", "description", "instructions", "tone", "boundaries", "stylePreset",
    "responseLength", "signaturePhrases", "prohibitedTopics", "greeting",
  ]);
  return {
    name: text(input, "name", 80, { required: true })!,
    description: text(input, "description", 500, { defaultValue: "" })!,
    instructions: text(input, "instructions", 4000, { defaultValue: "" })!,
    tone: text(input, "tone", 500, { defaultValue: "" })!,
    boundaries: boundaryList(input, false) ?? [],
    stylePreset: stylePreset(input.stylePreset, true)!,
    responseLength: responseLength(input.responseLength, true)!,
    signaturePhrases: stringList(input, "signaturePhrases", { required: false, maximumItems: 20, maximumLength: 120 }) ?? [],
    prohibitedTopics: stringList(input, "prohibitedTopics", { required: false, maximumItems: 20, maximumLength: 120 }) ?? [],
    greeting: text(input, "greeting", 500, { defaultValue: "" })!,
  };
}

function parseUpdateAgent(body: unknown): UpdateAgentInput {
  const input = objectBody(body);
  const allowed = [
    "name", "description", "instructions", "tone", "boundaries", "stylePreset",
    "responseLength", "signaturePhrases", "prohibitedTopics", "greeting",
  ];
  rejectUnknown(input, allowed);
  if (!allowed.some((field) => input[field] !== undefined)) {
    throw new RequestValidationError("At least one agent field is required.");
  }
  return {
    name: text(input, "name", 80, { required: input.name !== undefined }),
    description: text(input, "description", 500),
    instructions: text(input, "instructions", 4000),
    tone: text(input, "tone", 500),
    boundaries: boundaryList(input, false),
    stylePreset: stylePreset(input.stylePreset, false),
    responseLength: responseLength(input.responseLength, false),
    signaturePhrases: stringList(input, "signaturePhrases", { required: false, maximumItems: 20, maximumLength: 120 }),
    prohibitedTopics: stringList(input, "prohibitedTopics", { required: false, maximumItems: 20, maximumLength: 120 }),
    greeting: text(input, "greeting", 500),
  };
}

function stylePreset(value: unknown, useDefault: boolean) {
  if (value === undefined && useDefault) return "warm" as const;
  if (value === undefined) return undefined;
  if (value !== "warm" && value !== "direct" && value !== "curious" && value !== "custom") {
    throw new RequestValidationError("stylePreset must be warm, direct, curious, or custom.");
  }
  return value;
}

function responseLength(value: unknown, useDefault: boolean) {
  if (value === undefined && useDefault) return "balanced" as const;
  if (value === undefined) return undefined;
  if (value !== "short" && value !== "balanced" && value !== "deep") {
    throw new RequestValidationError("responseLength must be short, balanced, or deep.");
  }
  return value;
}

function parseCreateSource(body: unknown): CreateSourceInput {
  const input = objectBody(body);
  rejectUnknown(input, ["title", "type"]);
  const type = input.type;
  if (type !== "document" && type !== "audio" && type !== "video") {
    throw new RequestValidationError("type must be document, audio, or video.");
  }
  return { title: text(input, "title", 160, { required: true })!, type: type as SourceType };
}

function parseVisibility(body: unknown): SourceVisibility {
  const input = objectBody(body);
  rejectUnknown(input, ["visibility"]);
  if (input.visibility !== "preview" && input.visibility !== "public" && input.visibility !== "disabled") {
    throw new RequestValidationError("visibility must be preview, public, or disabled.");
  }
  return input.visibility;
}

function parseVideoUpload(body: unknown) {
  const input = objectBody(body);
  rejectUnknown(input, ["title", "fileName", "contentType", "size"]);
  const title = text(input, "title", 160, { required: true })!;
  const fileName = text(input, "fileName", 255, { required: true })!;
  if (!fileName.toLowerCase().endsWith(".mp4")) {
    throw new RequestValidationError("The first private upload slice accepts MP4 files only.");
  }
  if (input.contentType !== "video/mp4") {
    throw new RequestValidationError("contentType must be video/mp4.");
  }
  if (typeof input.size !== "number" || !Number.isInteger(input.size) || input.size < 1 || input.size > 250_000_000) {
    throw new RequestValidationError("size must be an integer between 1 byte and 250 MB.");
  }
  return { title, contentType: input.contentType, size: input.size };
}

function availableStorage(storage?: ObjectStorage) {
  if (!storage?.isAvailable) throw new ObjectStorageUnavailableError("Private object storage is not configured.");
  return storage;
}

function resourceId(value: string | undefined, label: string) {
  if (!value || !UUID_PATTERN.test(value)) throw new RequestValidationError(`${label} must be a UUID.`);
  return value;
}

function publicCreator(creator: CreatorRecord) {
  return { id: creator.id, createdAt: creator.createdAt, lastSeenAt: creator.lastSeenAt };
}

function publicAgent(agent: AgentRecord) {
  const { ownerId: _ownerId, ...safe } = agent;
  return safe;
}

function publicSource(source: SourceRecord) {
  const { ownerId: _ownerId, ...safe } = source;
  return safe;
}
