// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCreatorProfile, resolveCreatorApiConfiguration } from "./creator-workspace";

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
});
