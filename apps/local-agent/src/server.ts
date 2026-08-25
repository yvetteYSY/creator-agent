import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleLocalAgentRequest, LocalAgentRequestError } from "./handler";

const port = Number.parseInt(process.env.LOCAL_AGENT_PORT ?? "4310", 10);
const allowedOrigin =
  process.env.LOCAL_AGENT_ALLOWED_ORIGIN ?? "http://127.0.0.1:4173";
const expectedToken = process.env.LOCAL_AGENT_BEARER_TOKEN?.trim();

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  origin?: string,
) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin === allowedOrigin ? origin : allowedOrigin,
    vary: "origin",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new LocalAgentRequestError("Request body exceeds 1 MB.");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LocalAgentRequestError("Request body must be valid JSON.");
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && origin !== allowedOrigin) {
    sendJson(response, 403, { error: "Origin is not allowed." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "600",
      vary: "origin",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      provider: "local-reference-agent",
      aiCalls: 0,
    }, origin);
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/respond") {
    sendJson(response, 404, { error: "Not found." }, origin);
    return;
  }
  if (
    expectedToken &&
    request.headers.authorization !== `Bearer ${expectedToken}`
  ) {
    sendJson(response, 401, { error: "Invalid bearer token." }, origin);
    return;
  }

  try {
    const body = await readBody(request);
    sendJson(response, 200, handleLocalAgentRequest(body), origin);
  } catch (error) {
    const message =
      error instanceof LocalAgentRequestError
        ? error.message
        : "The local reference agent failed.";
    sendJson(response, 400, { error: message }, origin);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Zero-cost local agent listening on http://127.0.0.1:${port}`);
});
