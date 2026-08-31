import { describe, expect, it, vi } from "vitest";
import type { AccessTokenVerifier } from "../src/auth";
import type { CreatorRepository } from "../src/creator-store";
import type { GitHubAppApi, GitHubInstallation } from "../src/github-app";
import type { GitHubInstallationRecord, GitHubIntegrationRepository } from "../src/github-store";
import { completeGitHubConnection, handleApiRequest } from "../src/handler";
import type { WorkspaceRepository } from "../src/workspace-store";

const ownerId = "37b8b6b1-82e6-4d2f-9620-3cf6468ccbaa";
const agentId = "ed2902e8-b447-4801-a931-d7d71eb09aa7";
const sourceId = "8940a7a8-296c-464c-b36e-4865093d14d1";
const verifier: AccessTokenVerifier = {
  verify: vi.fn(async () => ({
    issuer: "https://tenant.example/",
    subject: "auth0|creator",
    scopes: new Set(["read:creator", "write:agent"]),
  })),
};
const creators: CreatorRepository = {
  upsertIdentity: vi.fn(async () => ({
    id: ownerId,
    issuer: "https://tenant.example/",
    subject: "auth0|creator",
    createdAt: "2026-08-30T00:00:00.000Z",
    lastSeenAt: "2026-08-30T00:00:00.000Z",
  })),
};
const installation: GitHubInstallation = {
  id: 42,
  accountLogin: "octo",
  accountType: "User",
  repositorySelection: "selected",
  suspended: false,
};

function dependencies() {
  const installationRecord: GitHubInstallationRecord = {
    ...installation,
    ownerId,
    status: "active",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
  const github: GitHubAppApi = {
    installationUrl: vi.fn((state) => `https://github.com/apps/creator-agent-content/installations/new?state=${state}`),
    authorizeUserInstallation: vi.fn(async () => installation),
    getInstallation: vi.fn(async () => installation),
    listRepositories: vi.fn(async () => [{
      id: 9,
      owner: "octo",
      name: "creator-notes",
      fullName: "octo/creator-notes",
      private: true,
      defaultBranch: "main",
    }]),
    readTextFile: vi.fn(async () => ({
      content: "# Guide\n\nPublish one useful idea.",
      sha: "abc123",
      htmlUrl: "https://github.com/octo/creator-notes/blob/main/docs/guide.md",
      size: 34,
    })),
  };
  const githubIntegrations: GitHubIntegrationRepository = {
    beginConnection: vi.fn(async () => undefined),
    completeConnection: vi.fn(async () => installationRecord),
    listInstallations: vi.fn(async () => [installationRecord]),
    getInstallation: vi.fn(async () => installationRecord),
    importTextSource: vi.fn(async (_ownerId, _agentId, input) => ({
      source: {
        id: sourceId,
        ownerId,
        agentId,
        title: input.title,
        type: "document" as const,
        status: "ready" as const,
        visibility: "preview" as const,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
      },
      content: input.file.content,
      origin: {
        repository: `${input.repositoryOwner}/${input.repositoryName}`,
        path: input.path,
        sha: input.file.sha,
        htmlUrl: input.file.htmlUrl,
      },
    })),
    updateInstallationStatus: vi.fn(async () => undefined),
  };
  return {
    verifier,
    creators,
    workspace: {} as WorkspaceRepository,
    github,
    githubIntegrations,
  };
}

describe("GitHub App creator routes", () => {
  it("starts an expiring, creator-bound installation flow without exposing the state digest", async () => {
    const deps = dependencies();
    const response = await handleApiRequest({
      method: "POST",
      path: "/v1/github/connect",
      authorization: "Bearer token",
    }, deps);
    expect(response.status).toBe(201);
    const body = response.body as { installationUrl: string; expiresInSeconds: number };
    expect(body.installationUrl).toMatch(/^https:\/\/github\.com\/apps\/creator-agent-content\/installations\/new\?state=/);
    expect(body.expiresInSeconds).toBe(600);
    const [boundOwner, digest] = vi.mocked(deps.githubIntegrations.beginConnection).mock.calls[0]!;
    expect(boundOwner).toBe(ownerId);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(body.installationUrl).not.toContain(digest);
  });

  it("confirms the installer through GitHub before completing the creator binding", async () => {
    const deps = dependencies();
    await completeGitHubConnection({
      state: "a".repeat(43),
      code: "authorization_code",
      installationId: 42,
    }, deps);
    expect(deps.github.authorizeUserInstallation).toHaveBeenCalledWith("authorization_code", 42);
    expect(deps.githubIntegrations.completeConnection).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      installation,
    );
  });

  it("lists only the authenticated creator's installations and their repositories", async () => {
    const deps = dependencies();
    const installs = await handleApiRequest({
      method: "GET",
      path: "/v1/github/installations",
      authorization: "Bearer token",
    }, deps);
    expect(installs.status).toBe(200);
    expect(JSON.stringify(installs.body)).not.toContain(ownerId);
    expect(deps.githubIntegrations.listInstallations).toHaveBeenCalledWith(ownerId);

    const repositories = await handleApiRequest({
      method: "GET",
      path: "/v1/github/installations/42/repositories",
      authorization: "Bearer token",
    }, deps);
    expect(repositories.status).toBe(200);
    expect(deps.githubIntegrations.getInstallation).toHaveBeenCalledWith(ownerId, 42);
    expect(deps.github.listRepositories).toHaveBeenCalledWith(42);
  });

  it("imports selected Markdown as preview-only knowledge and returns no GitHub token", async () => {
    const deps = dependencies();
    const response = await handleApiRequest({
      method: "POST",
      path: `/v1/agents/${agentId}/sources/github`,
      authorization: "Bearer token",
      body: {
        installationId: 42,
        title: "Creator guide",
        repositoryOwner: "octo",
        repositoryName: "creator-notes",
        path: "docs/guide.md",
        ref: "main",
      },
    }, deps);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      source: { id: sourceId, visibility: "preview", status: "ready" },
      content: "# Guide\n\nPublish one useful idea.",
      origin: { repository: "octo/creator-notes", path: "docs/guide.md" },
    });
    expect(JSON.stringify(response.body)).not.toContain("token");
  });

  it("fails closed when the GitHub App is not configured", async () => {
    const response = await handleApiRequest({
      method: "POST",
      path: "/v1/github/connect",
      authorization: "Bearer token",
    }, { verifier, creators, workspace: {} as WorkspaceRepository });
    expect(response).toEqual({ status: 503, body: { error: "GitHub App integration is not configured." } });
  });
});
