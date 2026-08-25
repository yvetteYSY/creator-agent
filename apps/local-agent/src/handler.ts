import type {
  RemoteAgentRequest,
  RemoteAgentResponse,
} from "@creator-agent/core";

export class LocalAgentRequestError extends Error {}

export function handleLocalAgentRequest(input: unknown): RemoteAgentResponse {
  if (!input || typeof input !== "object") {
    throw new LocalAgentRequestError("Request body must be an object.");
  }
  const request = input as Partial<RemoteAgentRequest>;
  if (
    request.version !== "2026-08-24" ||
    typeof request.message?.content !== "string" ||
    !Array.isArray(request.context)
  ) {
    throw new LocalAgentRequestError("Request does not match the agent route contract.");
  }

  const approved = request.context.filter(
    (citation) =>
      citation &&
      typeof citation.sourceId === "string" &&
      typeof citation.excerpt === "string" &&
      typeof citation.title === "string",
  );
  if (approved.length === 0) {
    return {
      answer: "The local reference agent did not receive enough approved context to answer.",
      citations: [],
      provider: "local-reference-agent",
    };
  }

  const primary = approved[0];
  const secondary = approved[1];
  return {
    answer: `Local routed answer: ${primary.excerpt}${secondary ? ` ${secondary.excerpt}` : ""}`,
    citations: [primary.sourceId, ...(secondary ? [secondary.sourceId] : [])],
    provider: "local-reference-agent",
  };
}
