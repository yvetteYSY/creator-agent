import { CreatorAgentError } from "./engine";
import type {
  AgentGenerationInput,
  AgentGenerationOutput,
  RemoteAgentRequest,
  RemoteAgentResponse,
  RemoteAgentRouteConfig,
} from "./types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function validateRemoteAgentEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new CreatorAgentError("INVALID_INPUT", "Enter a valid agent endpoint URL.");
  }

  if (url.username || url.password) {
    throw new CreatorAgentError(
      "INVALID_INPUT",
      "Credentials must not be embedded in the endpoint URL.",
    );
  }
  const isSecure = url.protocol === "https:";
  const isLocalHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!isSecure && !isLocalHttp) {
    throw new CreatorAgentError(
      "INVALID_INPUT",
      "Remote endpoints require HTTPS; HTTP is allowed only for localhost.",
    );
  }
  return url;
}

export async function invokeRemoteAgent(
  config: RemoteAgentRouteConfig,
  input: AgentGenerationInput,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<AgentGenerationOutput> {
  const endpoint = validateRemoteAgentEndpoint(config.endpoint);
  if (typeof fetchImplementation !== "function") {
    throw new CreatorAgentError("INVALID_STATE", "No network client is available.");
  }

  const request: RemoteAgentRequest = {
    version: "2026-08-24",
    agent: {
      id: input.agent.id,
      name: input.agent.name,
      instructions: [
        `Tone: ${input.agent.tone}`,
        `Style preset: ${input.agent.stylePreset}`,
        `Response depth: ${input.agent.responseLength}`,
        input.agent.signaturePhrases.length
          ? `Optional signature language: ${input.agent.signaturePhrases.join(" | ")}`
          : "Optional signature language: none",
        input.agent.prohibitedTopics.length
          ? `Prohibited topics: ${input.agent.prohibitedTopics.join(" | ")}`
          : "Prohibited topics: none beyond platform policy",
        `Boundaries: ${input.agent.boundaries}`,
      ].join("\n"),
    },
    conversation: {
      id: input.conversationId,
      history: input.history,
    },
    message: { content: input.question },
    context: input.context,
  };
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(Math.max(config.timeoutMs ?? 20_000, 1_000), 60_000),
  );

  try {
    const response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.bearerToken?.trim()
          ? { authorization: `Bearer ${config.bearerToken.trim()}` }
          : {}),
      },
      body: JSON.stringify(request),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CreatorAgentError(
        "INVALID_STATE",
        `The routed agent returned HTTP ${response.status}.`,
      );
    }
    const payload = (await response.json()) as Partial<RemoteAgentResponse>;
    if (typeof payload.answer !== "string" || !payload.answer.trim()) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "The routed agent response must include a non-empty answer.",
      );
    }
    const citations = Array.isArray(payload.citations)
      ? payload.citations.filter((value): value is string => typeof value === "string")
      : [];
    return {
      answer: payload.answer.trim(),
      citedSourceIds: citations,
    };
  } catch (error) {
    if (error instanceof CreatorAgentError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CreatorAgentError("INVALID_STATE", "The routed agent timed out.");
    }
    throw new CreatorAgentError(
      "INVALID_STATE",
      "The routed agent could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
