// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDurableSource,
  DEFAULT_DURABLE_AGENT,
  deleteDurableSource,
  fetchCreatorProfile,
  openCreatorWorkspace,
  resolveCreatorApiConfiguration,
  saveDurableAgent,
  saveDurableSourceVisibility,
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
});
