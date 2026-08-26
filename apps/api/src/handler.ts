import {
  AuthenticationError,
  readBearerToken,
  type AccessTokenVerifier,
} from "./auth";
import { CreatorAccessRevokedError, type CreatorRepository } from "./creator-store";

export interface ApiRequest {
  method: string;
  path: string;
  authorization?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDependencies {
  verifier: AccessTokenVerifier;
  creators: CreatorRepository;
}

export async function handleApiRequest(
  request: ApiRequest,
  dependencies: ApiDependencies,
): Promise<ApiResponse> {
  if (request.method === "GET" && request.path === "/health") {
    return { status: 200, body: { ok: true, service: "creator-agent-api", aiCalls: 0 } };
  }

  if (request.method !== "GET" || request.path !== "/v1/me") {
    return { status: 404, body: { error: "Not found." } };
  }

  try {
    const accessToken = readBearerToken(request.authorization);
    const principal = await dependencies.verifier.verify(accessToken);
    if (!principal.scopes.has("read:creator")) {
      return { status: 403, body: { error: "Forbidden." } };
    }
    const creator = await dependencies.creators.upsertIdentity(principal);
    return {
      status: 200,
      body: {
        creator: {
          id: creator.id,
          createdAt: creator.createdAt,
          lastSeenAt: creator.lastSeenAt,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: 401, body: { error: "Unauthorized." } };
    }
    if (error instanceof CreatorAccessRevokedError) {
      return { status: 403, body: { error: "Forbidden." } };
    }
    throw error;
  }
}
