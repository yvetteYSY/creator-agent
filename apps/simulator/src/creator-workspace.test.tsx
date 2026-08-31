// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginGitHubConnection,
  createDurableSource,
  DEFAULT_DURABLE_AGENT,
  deleteDurableSource,
  fetchCreatorProfile,
  importDurableGitHubSource,
  listDurableGitHubRepositories,
  openCreatorWorkspace,
  resolveCreatorApiConfiguration,
  saveDurableAgent,
  saveDurableSourceVisibility,
  uploadDurableVideo,
} from "./creator-workspace";

const durableAgent = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: DEFAULT_DURABLE_AGENT.name,
  description: DEFAULT_DURABLE_AGENT.description,
  status: "draft",
  configurationVersion: 1,
  configuration: {
    instructions: DEFAULT_DURABLE_AGENT.instructions,
    tone: DEFAULT_DURABLE_AGENT.tone,
    boundaries: DEFAULT_DURABLE_AGENT.boundaries,
    stylePreset: DEFAULT_DURABLE_AGENT.stylePreset,
    responseLength: DEFAULT_DURABLE_AGENT.responseLength,
    signaturePhrases: DEFAULT_DURABLE_AGENT.signaturePhrases,
    prohibitedTopics: DEFAULT_DURABLE_AGENT.prohibitedTopics,
    greeting: DEFAULT_DURABLE_AGENT.greeting,
  },
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const durableSource = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  agentId: durableAgent.id,
  title: "Workshop",
  type: "video",
  status: "awaiting_upload",
  visibility: "preview",
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("protected creator workspace client", () => {
  it("requires an exact API origin in Auth0 mode but no API in local mode", () => {
    expect(resolveCreatorApiConfiguration({}, "local", false)).toEqual({ mode: "local" });
    expect(resolveCreatorApiConfiguration({}, "auth0", false).error).toMatch(/required/i);
    expect(resolveCreatorApiConfiguration({ VITE_CREATOR_API_URL: "http://api.example" }, "auth0", false).error).toMatch(/HTTPS/i);
    expect(resolveCreatorApiConfiguration({ VITE_CREATOR_API_URL: "http://127.0.0.1:4320" }, "auth0", true)).toEqual({
      mode: "auth0",
      baseUrl: "http://127.0.0.1:4320",
    });
  });

  it("sends the Auth0 access token and accepts only a valid creator profile", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      creator: {
        id: "creator-internal",
        createdAt: "2026-08-25T00:00:00.000Z",
        lastSeenAt: "2026-08-25T00:00:01.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const profile = await fetchCreatorProfile({
      baseUrl: "https://api.example",
      getAccessToken: async () => "signed-token",
      fetcher,
    });
    expect(profile.id).toBe("creator-internal");
    expect(fetcher).toHaveBeenCalledWith("https://api.example/v1/me", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer signed-token" }),
    }));
  });

  it("fails closed on missing tokens, rejected sessions, and malformed profiles", async () => {
    await expect(fetchCreatorProfile({
      baseUrl: "https://api.example",
      getAccessToken: async () => null,
      fetcher: vi.fn(),
    })).rejects.toThrowError(/did not issue/i);
    await expect(fetchCreatorProfile({
      baseUrl: "https://api.example",
      getAccessToken: async () => "bad-token",
      fetcher: vi.fn(async () => new Response("", { status: 401 })),
    })).rejects.toThrowError(/rejected/i);
    await expect(fetchCreatorProfile({
      baseUrl: "https://api.example",
      getAccessToken: async () => "token",
      fetcher: vi.fn(async () => new Response(JSON.stringify({ creator: { id: "only-id" } }), { status: 200 })),
    })).rejects.toThrowError(/invalid profile/i);
  });

  it("opens the durable workspace and bootstraps one private creator agent", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v1/me")) return json({
        creator: { id: "creator-internal", createdAt: durableAgent.createdAt, lastSeenAt: durableAgent.updatedAt },
      });
      if (target.endsWith("/v1/agents") && init?.method === "GET") return json({ agents: [] });
      if (target.endsWith("/v1/agents") && init?.method === "POST") return json({ agent: durableAgent }, 201);
      if (target.endsWith(`/v1/agents/${durableAgent.id}/sources`)) return json({ sources: [] });
      return json({ error: "unexpected request" }, 500);
    });
    const workspace = await openCreatorWorkspace({
      baseUrl: "https://api.example",
      getAccessToken: async () => "signed-token",
      fetcher,
    });
    expect(workspace.profile.id).toBe("creator-internal");
    expect(workspace.agent.id).toBe(durableAgent.id);
    expect(workspace.sources).toEqual([]);
    const createCall = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject(DEFAULT_DURABLE_AGENT);
    expect(String(createCall?.[1]?.body)).not.toContain("ownerId");
  });

  it("writes versioned customization and private source metadata with bearer authorization", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH" && String(url).endsWith(`/v1/agents/${durableAgent.id}`)) {
        return json({ agent: {
          ...durableAgent,
          configurationVersion: 2,
          configuration: { ...durableAgent.configuration, tone: "Direct" },
        } });
      }
      if (init?.method === "POST") return json({ source: durableSource }, 201);
      if (init?.method === "PATCH") return json({
        source: { ...durableSource, status: "ready", visibility: "public" },
      });
      if (init?.method === "DELETE") return json({ deleted: true });
      return json({ error: "unexpected request" }, 500);
    });
    const common = {
      baseUrl: "https://api.example",
      agentId: durableAgent.id,
      getAccessToken: async () => "signed-token",
      fetcher,
    };
    expect((await saveDurableAgent({ ...common, patch: { tone: "Direct" } })).configurationVersion).toBe(2);
    expect((await createDurableSource({
      ...common,
      input: { title: "Workshop", type: "video" },
    })).visibility).toBe("preview");
    expect((await saveDurableSourceVisibility({
      ...common,
      sourceId: durableSource.id,
      visibility: "public",
    })).visibility).toBe("public");
    await deleteDurableSource({ ...common, sourceId: durableSource.id });
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({ authorization: "Bearer signed-token" });
      expect(String(init?.body ?? "")).not.toContain("ownerId");
    }
  });

  it("rejects malformed durable agent data before rendering the workspace", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/me")) return json({
        creator: { id: "creator-internal", createdAt: durableAgent.createdAt, lastSeenAt: durableAgent.updatedAt },
      });
      return json({ agents: [{ id: durableAgent.id, name: "Incomplete" }] });
    });
    await expect(openCreatorWorkspace({
      baseUrl: "https://api.example",
      getAccessToken: async () => "signed-token",
      fetcher,
    })).rejects.toThrowError(/invalid agent/i);
  });

  it("uploads video directly without sending the Auth0 token to object storage", async () => {
    const file = new File([new Uint8Array([0, 0, 0, 20])], "private.mp4", { type: "video/mp4" });
    const storageUrl = "https://storage.example/private-upload";
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/sources/uploads")) return json({
        source: durableSource,
        upload: {
          url: storageUrl,
          fields: { key: "private-uploads/opaque", policy: "signed", "Content-Type": "video/mp4" },
          expiresAt: "2026-08-25T00:10:00.000Z",
        },
      }, 201);
      if (target === storageUrl) return new Response(null, { status: 204 });
      if (target.endsWith(`/sources/${durableSource.id}/complete`)) return json({
        source: { ...durableSource, status: "uploaded" },
      });
      return json({ error: "unexpected request" }, 500);
    });
    const source = await uploadDurableVideo({
      baseUrl: "https://api.example",
      agentId: durableAgent.id,
      title: "Private workshop",
      file,
      getAccessToken: async () => "auth0-access-token",
      fetcher,
    });
    expect(source.status).toBe("uploaded");
    const storageCall = fetcher.mock.calls.find(([url]) => String(url) === storageUrl);
    expect(storageCall?.[1]?.headers).toBeUndefined();
    expect(storageCall?.[1]?.body).toBeInstanceOf(FormData);
    const form = storageCall?.[1]?.body as FormData;
    expect(form.get("key")).toBe("private-uploads/opaque");
    expect(form.get("file")).toBe(file);
    for (const [url, init] of fetcher.mock.calls.filter(([url]) => String(url).startsWith("https://api.example"))) {
      expect(String(url)).not.toBe(storageUrl);
      expect(init?.headers).toMatchObject({ authorization: "Bearer auth0-access-token" });
    }
  });

  it("refuses an insecure remote upload destination before sending file bytes", async () => {
    const file = new File([new Uint8Array([0, 0, 0, 20])], "private.mp4", { type: "video/mp4" });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/sources/uploads")) return json({
        source: durableSource,
        upload: {
          url: "http://storage.example/private-upload",
          fields: { key: "private-uploads/opaque", policy: "signed", "Content-Type": "video/mp4" },
          expiresAt: "2026-08-25T00:10:00.000Z",
        },
      }, 201);
      if (target.endsWith(`/sources/${durableSource.id}`)) return json({ deleted: true });
      return json({ error: "unexpected request" }, 500);
    });

    await expect(uploadDurableVideo({
      baseUrl: "https://api.example",
      agentId: durableAgent.id,
      title: "Private workshop",
      file,
      getAccessToken: async () => "auth0-access-token",
      fetcher,
    })).rejects.toThrowError(/unsafe upload destination/i);
    expect(fetcher.mock.calls.some(([url]) => String(url) === "http://storage.example/private-upload"))
      .toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith(`/sources/${durableSource.id}`)))
      .toBe(true);
  });

  it("accepts only a github.com installation redirect", async () => {
    const common = {
      baseUrl: "https://api.example",
      getAccessToken: async () => "signed-token",
    };
    await expect(beginGitHubConnection({
      ...common,
      fetcher: vi.fn(async () => json({ installationUrl: "https://github.com/apps/creator-agent/installations/new?state=opaque" })),
    })).resolves.toMatch(/^https:\/\/github\.com\/apps\/creator-agent/);
    await expect(beginGitHubConnection({
      ...common,
      fetcher: vi.fn(async () => json({ installationUrl: "https://github.com.evil.example/steal" })),
    })).rejects.toThrowError(/unsafe GitHub installation URL/i);
  });

  it("lists approved repositories and imports selected text without receiving a GitHub token", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v1/github/installations/42/repositories")) return json({ repositories: [{
        id: 7,
        owner: "yvetteYSY",
        name: "creator-agent",
        fullName: "yvetteYSY/creator-agent",
        private: false,
        defaultBranch: "main",
      }] });
      if (target.endsWith(`/v1/agents/${durableAgent.id}/sources/github`) && init?.method === "POST") return json({
        source: { ...durableSource, type: "document", status: "ready" },
        content: "# Creator guide\n\nPublish one durable idea.",
        origin: { htmlUrl: "https://github.com/yvetteYSY/creator-agent/blob/main/README.md" },
      }, 201);
      return json({ error: "unexpected request" }, 500);
    });
    const common = {
      baseUrl: "https://api.example",
      getAccessToken: async () => "auth0-access-token",
      fetcher,
    };
    const repositories = await listDurableGitHubRepositories({ ...common, installationId: 42 });
    expect(repositories[0]?.fullName).toBe("yvetteYSY/creator-agent");
    const imported = await importDurableGitHubSource({
      ...common,
      agentId: durableAgent.id,
      input: {
        installationId: 42,
        title: "Creator guide",
        repositoryOwner: "yvetteYSY",
        repositoryName: "creator-agent",
        path: "README.md",
      },
    });
    expect(imported.content).toContain("Publish one durable idea");
    expect(imported.source.visibility).toBe("preview");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("githubToken");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("installationToken");
  });
});
