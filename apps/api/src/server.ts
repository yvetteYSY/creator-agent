import { createServer, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { Auth0AccessTokenVerifier } from "./auth";
import { loadApiConfiguration } from "./config";
import { PostgresCreatorRepository } from "./creator-store";
import { handleApiRequest } from "./handler";

const configuration = loadApiConfiguration(process.env);
const pool = new Pool({ connectionString: configuration.databaseUrl });
const dependencies = {
  verifier: new Auth0AccessTokenVerifier(configuration),
  creators: new PostgresCreatorRepository(pool),
};

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
  const origin = request.headers.origin;
  if (origin && origin !== configuration.allowedOrigin) {
    sendJson(response, 403, { error: "Origin is not allowed." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": configuration.allowedOrigin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "authorization",
      "access-control-max-age": "600",
      vary: "origin",
    });
    response.end();
    return;
  }
  try {
    const result = await handleApiRequest({
      method: request.method ?? "GET",
      path: new URL(request.url ?? "/", "http://api.local").pathname,
      authorization: request.headers.authorization,
    }, dependencies);
    sendJson(response, result.status, result.body, origin);
  } catch {
    sendJson(response, 500, { error: "Internal server error." }, origin);
  }
});

server.listen(configuration.port, "127.0.0.1", () => {
  console.log(`Creator Agent API listening on http://127.0.0.1:${configuration.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
