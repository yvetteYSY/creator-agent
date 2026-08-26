import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthenticatedPrincipal {
  issuer: string;
  subject: string;
  scopes: ReadonlySet<string>;
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedPrincipal>;
}

export interface Auth0VerifierConfiguration {
  issuer: string;
  audience: string;
}

export class AuthenticationError extends Error {}

export function normalizeIssuer(value: string) {
  const issuer = new URL(value);
  if (issuer.protocol !== "https:") {
    throw new Error("AUTH0_ISSUER_BASE_URL must use HTTPS.");
  }
  issuer.pathname = issuer.pathname.endsWith("/") ? issuer.pathname : `${issuer.pathname}/`;
  issuer.search = "";
  issuer.hash = "";
  return issuer.toString();
}

export function readBearerToken(authorization?: string) {
  if (!authorization) throw new AuthenticationError("A bearer access token is required.");
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) throw new AuthenticationError("The authorization header must contain one bearer token.");
  return match[1];
}

export class Auth0AccessTokenVerifier implements AccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(configuration: Auth0VerifierConfiguration, keyResolver?: JWTVerifyGetKey) {
    this.issuer = normalizeIssuer(configuration.issuer);
    this.audience = configuration.audience.trim();
    if (!this.audience) throw new Error("AUTH0_AUDIENCE is required.");
    this.keyResolver = keyResolver ?? createRemoteJWKSet(new URL(".well-known/jwks.json", this.issuer), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }

  async verify(accessToken: string): Promise<AuthenticatedPrincipal> {
    try {
      const { payload } = await jwtVerify(accessToken, this.keyResolver, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim()) {
        throw new AuthenticationError("The access token has no subject.");
      }
      const scope = typeof payload.scope === "string" ? payload.scope : "";
      return {
        issuer: this.issuer,
        subject: payload.sub,
        scopes: new Set(scope.split(/\s+/).filter(Boolean)),
      };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("The access token is invalid.");
    }
  }
}
