import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleGitHubWebhook } from "../src/github-webhook";
import type { GitHubIntegrationRepository } from "../src/github-store";

const configuration = {
  clientId: "Iv1.client",
  clientSecret: "client-secret",
  callbackUrl: "https://api.example/v1/github/callback",
  privateKey: "unused",
  webhookSecret: "webhook-secret",
  slug: "creator-agent-content",
};

function signed(payload: object) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    payload: bytes,
    signature: `sha256=${createHmac("sha256", configuration.webhookSecret).update(bytes).digest("hex")}`,
  };
}

describe("GitHub webhook boundary", () => {
  it("rejects unsigned payloads before touching durable state", async () => {
    const updateInstallationStatus = vi.fn();
    const response = await handleGitHubWebhook({
      event: "installation",
      delivery: "delivery-1",
      payload: Buffer.from("{}"),
    }, configuration, { updateInstallationStatus } as unknown as GitHubIntegrationRepository);
    expect(response.status).toBe(401);
    expect(updateInstallationStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", "revoked"],
    ["suspend", "suspended"],
    ["unsuspend", "active"],
  ] as const)("maps installation %s to %s", async (action, status) => {
    const updateInstallationStatus = vi.fn(async () => undefined);
    const response = await handleGitHubWebhook({
      event: "installation",
      delivery: "delivery-1",
      ...signed({ action, installation: { id: 42 } }),
    }, configuration, { updateInstallationStatus } as unknown as GitHubIntegrationRepository);
    expect(response).toEqual({ status: 202, body: { accepted: true, event: "installation" } });
    expect(updateInstallationStatus).toHaveBeenCalledWith(42, status);
  });

  it("accepts a signed ping without updating installation state", async () => {
    const updateInstallationStatus = vi.fn();
    const response = await handleGitHubWebhook({
      event: "ping",
      delivery: "delivery-2",
      ...signed({ zen: "Keep it logically awesome." }),
    }, configuration, { updateInstallationStatus } as unknown as GitHubIntegrationRepository);
    expect(response).toEqual({ status: 200, body: { accepted: true, event: "ping" } });
    expect(updateInstallationStatus).not.toHaveBeenCalled();
  });

  it("rejects a signed malformed installation event without throwing or changing state", async () => {
    const updateInstallationStatus = vi.fn();
    const response = await handleGitHubWebhook({
      event: "installation",
      delivery: "delivery-3",
      ...signed({ action: "deleted", installation: { id: "not-a-number" } }),
    }, configuration, { updateInstallationStatus } as unknown as GitHubIntegrationRepository);
    expect(response).toEqual({
      status: 400,
      body: { accepted: false, error: "Invalid installation payload." },
    });
    expect(updateInstallationStatus).not.toHaveBeenCalled();
  });
});
