import type { GitHubAppConfiguration } from "./github-app";
import { verifyGitHubWebhookSignature } from "./github-app";
import type { GitHubInstallationStatus, GitHubIntegrationRepository } from "./github-store";

export interface GitHubWebhookRequest {
  event?: string;
  delivery?: string;
  signature?: string;
  payload: Buffer;
}

export interface GitHubWebhookResponse {
  status: number;
  body: { accepted: boolean; event?: string; error?: string };
}

export async function handleGitHubWebhook(
  request: GitHubWebhookRequest,
  configuration: GitHubAppConfiguration,
  integrations: GitHubIntegrationRepository,
): Promise<GitHubWebhookResponse> {
  if (!verifyGitHubWebhookSignature(configuration.webhookSecret, request.payload, request.signature)) {
    return { status: 401, body: { accepted: false, error: "Invalid webhook signature." } };
  }
  if (!request.event || !/^[a-z_]{1,80}$/.test(request.event)) {
    return { status: 400, body: { accepted: false, error: "Invalid webhook event." } };
  }
  if (!request.delivery || !/^[A-Za-z0-9-]{1,100}$/.test(request.delivery)) {
    return { status: 400, body: { accepted: false, error: "Invalid webhook delivery ID." } };
  }
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(request.payload.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    payload = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: { accepted: false, error: "Invalid webhook payload." } };
  }

  if (request.event === "ping") {
    return { status: 200, body: { accepted: true, event: request.event } };
  }
  if (request.event === "installation" || request.event === "installation_repositories") {
    let installationId: number;
    try {
      const installation = record(payload.installation);
      installationId = positiveInteger(installation.id);
    } catch {
      return { status: 400, body: { accepted: false, error: "Invalid installation payload." } };
    }
    const action = typeof payload.action === "string" ? payload.action : "";
    const status = installationStatus(request.event, action);
    if (status) await integrations.updateInstallationStatus(installationId, status);
  }
  return { status: 202, body: { accepted: true, event: request.event } };
}

function installationStatus(event: string, action: string): GitHubInstallationStatus | undefined {
  if (event === "installation_repositories") return "active";
  if (action === "deleted") return "revoked";
  if (action === "suspend") return "suspended";
  if (action === "created" || action === "unsuspend" || action === "new_permissions_accepted") return "active";
  return undefined;
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid installation payload.");
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("Invalid installation ID.");
  return Number(value);
}
