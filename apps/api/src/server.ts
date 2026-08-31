import { createServer, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { Auth0AccessTokenVerifier } from "./auth";
import { loadApiConfiguration } from "./config";
import { PostgresCreatorRepository } from "./creator-store";
import { handleApiRequest } from "./handler";
import { PostgresWorkspaceRepository } from "./workspace-store";
import { createObjectStorage, loadObjectStorageConfiguration } from "./object-storage";
import { PostgresTranscriptRepository } from "./transcript-store";
import { GitHubAppClient, loadGitHubAppConfiguration } from "./github-app";
import { PostgresGitHubIntegrationRepository } from "./github-store";
import { handleGitHubWebhook } from "./github-webhook";
import { completeGitHubConnection } from "./handler";

const configuration = loadApiConfiguration(process.env);
const pool = new Pool({ connectionString: configuration.databaseUrl });
const githubConfiguration = loadGitHubAppConfiguration(process.env);
const githubIntegrations = new PostgresGitHubIntegrationRepository(pool);
const github = githubConfiguration ? new GitHubAppClient(githubConfiguration) : undefined;
const dependencies = {
  verifier: new Auth0AccessTokenVerifier(configuration),
  creators: new PostgresCreatorRepository(pool),
  workspace: new PostgresWorkspaceRepository(pool),
  storage: createObjectStorage(loadObjectStorageConfiguration(process.env)),
  transcripts: new PostgresTranscriptRepository(pool),
  github,
  githubIntegrations: github ? githubIntegrations : undefined,
};

class HttpRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readRequestBody(request: import("node:http").IncomingMessage, maximumBytes = 64 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new HttpRequestError("Request body exceeds the route limit.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request: import("node:http").IncomingMessage, maximumBytes = 64 * 1024) {
  const body = await readRequestBody(request, maximumBytes);
  if (body.byteLength === 0) return undefined;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpRequestError("Request body must be valid JSON.", 400);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, origin?: string) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin === configuration.allowedOrigin ? origin : configuration.allowedOrigin,
    vary: "origin",
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://api.local");
  const requestPath = requestUrl.pathname;
  const origin = request.headers.origin;
  if (origin && origin !== configuration.allowedOrigin) {
    sendJson(response, 403, { error: "Origin is not allowed." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": configuration.allowedOrigin,
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "600",
      vary: "origin",
    });
    response.end();
    return;
  }
  try {
    if (request.method === "POST" && requestPath === "/v1/github/webhooks") {
      if (!githubConfiguration || !dependencies.githubIntegrations) {
        sendJson(response, 503, { error: "GitHub App integration is not configured." });
        return;
      }
      const result = await handleGitHubWebhook({
        event: header(request.headers["x-github-event"]),
        delivery: header(request.headers["x-github-delivery"]),
        signature: header(request.headers["x-hub-signature-256"]),
        payload: await readRequestBody(request, 1024 * 1024),
      }, githubConfiguration, dependencies.githubIntegrations);
      sendJson(response, result.status, result.body);
      return;
    }
    if (request.method === "GET" && requestPath === "/v1/github/callback") {
      if (!github) {
        sendJson(response, 503, { error: "GitHub App integration is not configured." });
        return;
      }
      try {
        const installationId = Number(requestUrl.searchParams.get("installation_id"));
        await completeGitHubConnection({
          state: requestUrl.searchParams.get("state") ?? "",
          code: requestUrl.searchParams.get("code") ?? "",
          installationId,
        }, dependencies);
        redirect(response, configuration.allowedOrigin, "connected");
      } catch {
        redirect(response, configuration.allowedOrigin, "error");
      }
      return;
    }
    const result = await handleApiRequest({
      method: request.method ?? "GET",
      path: requestPath,
      authorization: request.headers.authorization,
      body: request.method === "POST" || request.method === "PUT" || request.method === "PATCH"
        ? await readJsonBody(
          request,
          request.method === "PUT" && requestPath.endsWith("/transcript") ? 4 * 1024 * 1024 : undefined,
        )
        : undefined,
    }, dependencies);
    sendJson(response, result.status, result.body, origin);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      sendJson(response, error.status, { error: error.message }, origin);
    } else {
      sendJson(response, 500, { error: "Internal server error." }, origin);
    }
  }
});

server.listen(configuration.port, configuration.host, () => {
  console.log(`Creator Agent API listening on http://${configuration.host}:${configuration.port}`);
});

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function redirect(response: ServerResponse, origin: string, githubStatus: "connected" | "error") {
  const destination = new URL(origin);
  destination.searchParams.set("github", githubStatus);
  response.writeHead(303, { location: destination.toString(), "cache-control": "no-store" });
  response.end();
}

async function shutdown() {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
