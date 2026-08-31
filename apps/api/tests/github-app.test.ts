import { generateKeyPair, exportPKCS8, jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  GitHubAppClient,
  GitHubContentValidationError,
  loadGitHubAppConfiguration,
  verifyGitHubWebhookSignature,
} from "../src/github-app";

async function privateKeyPem() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  return { privateKey: await exportPKCS8(privateKey), publicKey };
}

describe("GitHub App security boundary", () => {
  it("loads a complete server-only configuration and rejects partial secrets", () => {
    expect(loadGitHubAppConfiguration({})).toBeUndefined();
    expect(() => loadGitHubAppConfiguration({ GITHUB_APP_CLIENT_ID: "Iv1.client" }))
      .toThrowError(/configured together/i);
    expect(loadGitHubAppConfiguration({
      GITHUB_APP_CLIENT_ID: "Iv1.client",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_CALLBACK_URL: "https://api.example/v1/github/callback",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----",
      GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_SLUG: "creator-agent-content",
    })).toEqual({
      clientId: "Iv1.client",
      clientSecret: "client-secret",
      callbackUrl: "https://api.example/v1/github/callback",
      privateKey: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
      webhookSecret: "webhook-secret",
      slug: "creator-agent-content",
    });
  });

  it("verifies GitHub's documented HMAC-SHA256 webhook vector", () => {
    const payload = Buffer.from("Hello, World!", "utf8");
    const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(verifyGitHubWebhookSignature("It's a Secret to Everybody", payload, signature)).toBe(true);
    expect(verifyGitHubWebhookSignature("wrong", payload, signature)).toBe(false);
    expect(verifyGitHubWebhookSignature("secret", payload, undefined)).toBe(false);
  });

  it("uses a short-lived app JWT to obtain an installation token and never returns it", async () => {
    const { privateKey, publicKey } = await privateKeyPem();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith("/app/installations/42/access_tokens")) {
        return Response.json({ token: "ghs_secret_installation_token", expires_at: "2026-08-30T01:00:00Z" });
      }
      if (url.endsWith("/installation/repositories?per_page=100&page=1")) {
        return Response.json({
          total_count: 1,
          repositories: [{
            id: 9,
            name: "creator-notes",
            full_name: "octo/creator-notes",
            private: true,
            default_branch: "main",
            owner: { login: "octo" },
          }],
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new GitHubAppClient({
      clientId: "Iv1.client",
      clientSecret: "client-secret",
      callbackUrl: "https://api.example/v1/github/callback",
      privateKey,
      webhookSecret: "secret",
      slug: "creator-agent-content",
    }, fetcher as typeof fetch, () => new Date("2026-08-30T00:00:00Z"));

    await expect(client.listRepositories(42)).resolves.toEqual([{
      id: 9,
      owner: "octo",
      name: "creator-notes",
      fullName: "octo/creator-notes",
      private: true,
      defaultBranch: "main",
    }]);
    expect(JSON.stringify(await client.listRepositories(42))).not.toContain("ghs_secret");

    const authorization = new Headers(requests[0]!.init?.headers).get("authorization")!;
    expect(authorization).toMatch(/^Bearer /);
    const jwt = authorization.slice("Bearer ".length);
    const verified = await jwtVerify(jwt, publicKey, {
      issuer: "Iv1.client",
      algorithms: ["RS256"],
      currentDate: new Date("2026-08-30T00:00:00Z"),
    });
    expect(verified.payload.exp! - verified.payload.iat!).toBeLessThanOrEqual(600);
    expect(new Headers(requests[1]!.init?.headers).get("authorization"))
      .toBe("Bearer ghs_secret_installation_token");
  });

  it("imports only bounded UTF-8 Markdown files from the selected repository", async () => {
    const { privateKey } = await privateKeyPem();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/access_tokens")) return Response.json({ token: "ghs_token" });
      if (url.includes("/contents/docs%2Fguide.md")) {
        return Response.json({
          type: "file",
          encoding: "base64",
          content: Buffer.from("# Creator guide\n\nPublish one useful idea.").toString("base64"),
          size: 42,
          sha: "abc123",
          html_url: "https://github.com/octo/creator-notes/blob/main/docs/guide.md",
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new GitHubAppClient({
      clientId: "Iv1.client",
      clientSecret: "client-secret",
      callbackUrl: "https://api.example/v1/github/callback",
      privateKey,
      webhookSecret: "secret",
      slug: "creator-agent-content",
    }, fetcher as typeof fetch);

    await expect(client.readTextFile({
      installationId: 42,
      owner: "octo",
      repository: "creator-notes",
      path: "docs/guide.md",
      ref: "main",
    })).resolves.toMatchObject({
      content: "# Creator guide\n\nPublish one useful idea.",
      sha: "abc123",
    });
    await expect(client.readTextFile({
      installationId: 42,
      owner: "octo",
      repository: "creator-notes",
      path: "secrets.env",
    })).rejects.toThrowError(GitHubContentValidationError);
    await expect(client.readTextFile({
      installationId: 42,
      owner: "octo",
      repository: "creator-notes",
      path: "../README.md",
    })).rejects.toThrowError(GitHubContentValidationError);
  });

  it("binds an installation only after GitHub confirms the authorizing user can access it", async () => {
    const { privateKey } = await privateKeyPem();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "github_user_token" });
      }
      if (url.endsWith("/user/installations?per_page=100")) {
        return Response.json({ installations: [{
          id: 42,
          account: { login: "octo", type: "User" },
          repository_selection: "selected",
          suspended_at: null,
        }] });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new GitHubAppClient({
      clientId: "Iv1.client",
      clientSecret: "client-secret",
      callbackUrl: "https://api.example/v1/github/callback",
      privateKey,
      webhookSecret: "secret",
      slug: "creator-agent-content",
    }, fetcher as typeof fetch);
    expect(client.installationUrl("a".repeat(32))).toContain("state=aaaaaaaa");
    await expect(client.authorizeUserInstallation("authorization_code", 42)).resolves.toMatchObject({
      id: 42,
      accountLogin: "octo",
    });
    expect(JSON.stringify(await client.authorizeUserInstallation("authorization_code", 42)))
      .not.toContain("github_user_token");
    await expect(client.authorizeUserInstallation("authorization_code", 99))
      .rejects.toThrowError(/cannot administer/i);
  });
});
