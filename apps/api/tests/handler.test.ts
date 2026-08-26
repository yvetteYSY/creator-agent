import { describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import {
  Auth0AccessTokenVerifier,
  AuthenticationError,
  normalizeIssuer,
  readBearerToken,
  type AccessTokenVerifier,
  type AuthenticatedPrincipal,
} from "../src/auth";
import { loadApiConfiguration } from "../src/config";
import { PostgresCreatorRepository, type CreatorRecord, type CreatorRepository } from "../src/creator-store";
import { handleApiRequest } from "../src/handler";

class MemoryCreatorRepository implements CreatorRepository {
  readonly records = new Map<string, CreatorRecord>();

  async upsertIdentity(principal: AuthenticatedPrincipal) {
    const key = `${principal.issuer}\u0000${principal.subject}`;
    const existing = this.records.get(key);
    if (existing) return existing;
    const createdAt = "2026-08-25T00:00:00.000Z";
    const record = {
      id: `creator-${this.records.size + 1}`,
      issuer: principal.issuer,
      subject: principal.subject,
      createdAt,
      lastSeenAt: createdAt,
    };
    this.records.set(key, record);
    return record;
  }
}

function verifierFor(principal: AuthenticatedPrincipal): AccessTokenVerifier {
  return { verify: vi.fn(async () => principal) };
}

const principal = {
  issuer: "https://tenant.example/",
  subject: "auth0|creator-a",
  scopes: new Set(["read:creator"]),
};

describe("protected creator API", () => {
  it("normalizes a trusted HTTPS issuer and parses exactly one bearer token", () => {
    expect(normalizeIssuer("https://tenant.example")).toBe("https://tenant.example/");
    expect(readBearerToken("Bearer header.payload.signature")).toBe("header.payload.signature");
    expect(() => normalizeIssuer("http://tenant.example")).toThrowError(/HTTPS/);
    expect(() => readBearerToken("Basic abc")).toThrowError(AuthenticationError);
    expect(() => readBearerToken("Bearer one two")).toThrowError(AuthenticationError);
  });

  it("accepts only a correctly signed, unexpired RS256 token for this issuer and audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const configuration = {
      issuer: "https://tenant.example/",
      audience: "https://api.creator-agent.example",
    };
    const verifier = new Auth0AccessTokenVerifier(configuration, async () => publicKey);
    const token = await new SignJWT({ scope: "read:profile write:agent" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(configuration.issuer)
      .setAudience(configuration.audience)
      .setSubject("auth0|creator-a")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const verified = await verifier.verify(token);
    expect(verified.subject).toBe("auth0|creator-a");
    expect(verified.scopes).toEqual(new Set(["read:profile", "write:agent"]));

    const wrongAudience = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(configuration.issuer)
      .setAudience("https://wrong.example")
      .setSubject("auth0|creator-a")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const wrongIssuer = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://wrong-tenant.example/")
      .setAudience(configuration.audience)
      .setSubject("auth0|creator-a")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(configuration.issuer)
      .setAudience(configuration.audience)
      .setSubject("auth0|creator-a")
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey);
    for (const rejected of [wrongAudience, wrongIssuer, expired, "not-a-jwt"]) {
      await expect(verifier.verify(rejected)).rejects.toThrowError(AuthenticationError);
    }
  });

  it("fails closed when API secrets or exact CORS configuration are absent", () => {
    expect(() => loadApiConfiguration({})).toThrowError(/AUTH0_ISSUER_BASE_URL/);
    expect(() => loadApiConfiguration({
      AUTH0_ISSUER_BASE_URL: "https://tenant.example/",
      AUTH0_AUDIENCE: "https://api.example",
      DATABASE_URL: "postgres://database",
      API_PORT: "4320garbage",
    })).toThrowError(/valid TCP port/i);
    expect(() => loadApiConfiguration({
      AUTH0_ISSUER_BASE_URL: "https://tenant.example/",
      AUTH0_AUDIENCE: "https://api.example",
      DATABASE_URL: "postgres://database",
      API_ALLOWED_ORIGIN: "https://app.example/path",
    })).toThrowError(/exact HTTP\(S\) origin/i);
    expect(loadApiConfiguration({
      AUTH0_ISSUER_BASE_URL: "https://tenant.example/",
      AUTH0_AUDIENCE: "https://api.example",
      DATABASE_URL: "postgres://database",
      API_ALLOWED_ORIGIN: "https://app.example",
    }).allowedOrigin).toBe("https://app.example");
  });

  it("derives a durable creator ID only from the verified token principal", async () => {
    const creators = new MemoryCreatorRepository();
    const dependencies = { verifier: verifierFor(principal), creators };
    const first = await handleApiRequest({
      method: "GET",
      path: "/v1/me",
      authorization: "Bearer valid-token",
    }, dependencies);
    const second = await handleApiRequest({
      method: "GET",
      path: "/v1/me",
      authorization: "Bearer valid-token",
    }, dependencies);

    expect(first).toEqual({
      status: 200,
      body: {
        creator: {
          id: "creator-1",
          createdAt: "2026-08-25T00:00:00.000Z",
          lastSeenAt: "2026-08-25T00:00:00.000Z",
        },
      },
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(first.body)).not.toContain(principal.subject);
    expect(creators.records.size).toBe(1);
  });

  it("keeps different issuers and subjects in separate creator records", async () => {
    const creators = new MemoryCreatorRepository();
    await creators.upsertIdentity(principal);
    await creators.upsertIdentity({ ...principal, subject: "auth0|creator-b" });
    await creators.upsertIdentity({ ...principal, issuer: "https://other.example/" });
    expect(creators.records.size).toBe(3);
  });

  it("returns a generic 401 and never persists an unverified identity", async () => {
    const creators = new MemoryCreatorRepository();
    const verifier: AccessTokenVerifier = {
      verify: vi.fn(async () => { throw new AuthenticationError("wrong audience"); }),
    };
    const response = await handleApiRequest({
      method: "GET",
      path: "/v1/me",
      authorization: "Bearer invalid-token",
    }, { verifier, creators });
    expect(response).toEqual({ status: 401, body: { error: "Unauthorized." } });
    expect(creators.records.size).toBe(0);
  });

  it("returns 403 and does not persist when the token lacks creator scope", async () => {
    const creators = new MemoryCreatorRepository();
    const response = await handleApiRequest({
      method: "GET",
      path: "/v1/me",
      authorization: "Bearer valid-but-unprivileged-token",
    }, {
      verifier: verifierFor({ ...principal, scopes: new Set() }),
      creators,
    });
    expect(response).toEqual({ status: 403, body: { error: "Forbidden." } });
    expect(creators.records.size).toBe(0);
  });

  it("parameterizes the verified identity when persisting it", async () => {
    const query = vi.fn(async (_text: string, _parameters: unknown[]) => ({
      rows: [{
        id: "37b8b6b1-82e6-4d2f-9620-3cf6468ccbaa",
        auth_issuer: principal.issuer,
        auth_subject: principal.subject,
        created_at: new Date("2026-08-25T00:00:00.000Z"),
        last_seen_at: new Date("2026-08-25T00:00:01.000Z"),
      }],
    }));
    const repository = new PostgresCreatorRepository({ query } as never);
    const record = await repository.upsertIdentity(principal);
    expect(record.id).toBe("37b8b6b1-82e6-4d2f-9620-3cf6468ccbaa");
    expect(query).toHaveBeenCalledOnce();
    const [, parameters] = query.mock.calls[0];
    expect(parameters?.slice(1)).toEqual([principal.issuer, principal.subject]);
  });

  it("keeps health public and reports zero AI calls", async () => {
    const response = await handleApiRequest({ method: "GET", path: "/health" }, {
      verifier: verifierFor(principal),
      creators: new MemoryCreatorRepository(),
    });
    expect(response).toEqual({
      status: 200,
      body: { ok: true, service: "creator-agent-api", aiCalls: 0 },
    });
  });
});
