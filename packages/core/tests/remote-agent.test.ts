import { describe, expect, it, vi } from "vitest";
import {
  CreatorAgentEngine,
  invokeRemoteAgent,
  validateRemoteAgentEndpoint,
  type AgentGenerationInput,
} from "../src";

function fixture() {
  const engine = new CreatorAgentEngine();
  const agent = engine.createAgent({
    ownerId: "creator",
    name: "Routed Coach",
    handle: "routed",
  });
  const source = engine.addSource({
    ownerId: "creator",
    agentId: agent.id,
    title: "Approved guide",
    kind: "document",
    visibility: "public",
    content: "Publish one focused tutorial each week and review the questions people ask.",
  });
  engine.addSource({
    ownerId: "creator",
    agentId: agent.id,
    title: "Private notes",
    kind: "document",
    visibility: "preview",
    content: "The secret partner launch is codenamed ORCHID and must remain private.",
  });
  engine.publishAgent("creator", agent.id);
  const conversation = engine.createConversation(agent.id, "audience");
  return { engine, agent, source, conversation };
}

describe("remote agent routing", () => {
  it("allows HTTPS and local HTTP but rejects insecure remote endpoints", () => {
    expect(validateRemoteAgentEndpoint("https://agent.example.com/respond").hostname).toBe(
      "agent.example.com",
    );
    expect(validateRemoteAgentEndpoint("http://127.0.0.1:4310/v1/respond").port).toBe(
      "4310",
    );
    expect(() => validateRemoteAgentEndpoint("http://agent.example.com/respond")).toThrowError(
      /require HTTPS/i,
    );
    expect(() => validateRemoteAgentEndpoint("https://token@agent.example.com/respond")).toThrowError(
      /must not be embedded/i,
    );
  });

  it("sends the bearer token only as a header and validates the response", async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty("bearerToken");
      expect(body.context[0].title).toBe("Approved guide");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer user-token");
      return new Response(
        JSON.stringify({ answer: "Remote answer", citations: [body.context[0].sourceId] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const { engine, agent, source, conversation } = fixture();
    const result = await engine.sendMessageWithGenerator(
      {
        agentId: agent.id,
        conversationId: conversation.id,
        userId: "audience",
        question: "How often should I publish a tutorial?",
        idempotencyKey: "remote-1",
      },
      (input) =>
        invokeRemoteAgent(
          {
            endpoint: "https://agent.example.com/respond",
            bearerToken: "user-token",
          },
          input,
          fetchMock as typeof fetch,
        ),
    );

    expect(result.assistantMessage.content).toBe("Remote answer");
    expect(result.assistantMessage.citations[0].sourceId).toBe(source.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never sends preview-only source content to the routed agent", async () => {
    const { engine, agent, conversation } = fixture();
    const generator = vi.fn(async (input: AgentGenerationInput) => {
      expect(JSON.stringify(input)).not.toContain("ORCHID");
      expect(input.context.every((citation) => citation.title !== "Private notes")).toBe(true);
      return { answer: "I do not have that information.", citedSourceIds: [] };
    });

    await engine.sendMessageWithGenerator(
      {
        agentId: agent.id,
        conversationId: conversation.id,
        userId: "audience",
        question: "What is the secret partner launch?",
        idempotencyKey: "remote-private",
      },
      generator,
    );
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent routed requests", async () => {
    const { engine, agent, conversation } = fixture();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generator = vi.fn(async () => {
      await blocked;
      return { answer: "One response", citedSourceIds: [] };
    });
    const request = {
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience",
      question: "One question",
      idempotencyKey: "concurrent",
    };

    const first = engine.sendMessageWithGenerator(request, generator);
    const second = engine.sendMessageWithGenerator(request, generator);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(generator).toHaveBeenCalledTimes(1);
    expect(firstResult.assistantMessage.id).toBe(secondResult.assistantMessage.id);
    expect(secondResult.replayed).toBe(true);
  });
});
