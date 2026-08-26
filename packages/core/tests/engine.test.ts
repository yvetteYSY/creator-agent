import { describe, expect, it } from "vitest";
import { CreatorAgentEngine, CreatorAgentError } from "../src";

function createPublishedFixture() {
  const engine = new CreatorAgentEngine();
  const agent = engine.createAgent({
    ownerId: "creator-a",
    name: "Ari's Creative Coach",
    handle: "ari-coach",
  });
  const publicSource = engine.addSource({
    ownerId: "creator-a",
    agentId: agent.id,
    title: "Creative Systems",
    kind: "document",
    visibility: "public",
    content:
      "A sustainable publishing cadence starts with one useful weekly essay.\n\nRepurpose each essay into a short video and three audience prompts.",
  });
  const privateSource = engine.addSource({
    ownerId: "creator-a",
    agentId: agent.id,
    title: "Private launch notes",
    kind: "document",
    visibility: "preview",
    content:
      "The confidential launch password is ORCHID. This must never appear in public answers.",
  });
  engine.publishAgent("creator-a", agent.id);
  return { engine, agent, publicSource, privateSource };
}

describe("CreatorAgentEngine", () => {
  it("rejects cross-creator access at the engine boundary", () => {
    const { engine, agent, publicSource } = createPublishedFixture();

    expect(() => engine.listSources("creator-b", agent.id)).toThrowError(/belongs to another creator/i);
    expect(() => engine.updateAgent("creator-b", agent.id, { name: "Hijacked" }))
      .toThrowError(/belongs to another creator/i);
    expect(() => engine.setSourceVisibility("creator-b", publicSource.id, "preview"))
      .toThrowError(/another creator/i);
    expect(engine.getAgent(agent.id).name).toBe(agent.name);
  });

  it("requires an approved ready source before publishing", () => {
    const engine = new CreatorAgentEngine();
    const agent = engine.createAgent({
      ownerId: "creator-a",
      name: "Empty Agent",
      handle: "empty",
    });

    expect(() => engine.publishAgent("creator-a", agent.id)).toThrowError(
      /ready source approved for public answers/i,
    );
  });

  it("grounds answers and returns a citation to an approved source", () => {
    const { engine, agent, publicSource } = createPublishedFixture();
    const conversation = engine.createConversation(agent.id, "audience-1");
    const result = engine.sendMessage({
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience-1",
      question: "How should I create a sustainable publishing cadence?",
      idempotencyKey: "request-1",
    });

    expect(result.assistantMessage.citations).toHaveLength(1);
    expect(result.assistantMessage.citations[0].sourceId).toBe(publicSource.id);
    expect(result.assistantMessage.content).toContain("weekly essay");
  });

  it("never retrieves a preview-only source for a public conversation", () => {
    const { engine, agent, privateSource } = createPublishedFixture();
    const conversation = engine.createConversation(agent.id, "audience-1");
    const result = engine.sendMessage({
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience-1",
      question: "What is the confidential launch password?",
      idempotencyKey: "request-private",
    });

    expect(result.assistantMessage.citations).toEqual([]);
    expect(result.assistantMessage.content).toContain("don't have enough information");
    expect(result.assistantMessage.content).not.toContain("ORCHID");
    expect(result.assistantMessage.citations).not.toContainEqual(
      expect.objectContaining({ sourceId: privateSource.id }),
    );
  });

  it("isolates conversations between audience members", () => {
    const { engine, agent } = createPublishedFixture();
    const conversation = engine.createConversation(agent.id, "audience-1");

    expect(() => engine.getConversation(conversation.id, "audience-2")).toThrowError(
      CreatorAgentError,
    );
    expect(() =>
      engine.sendMessage({
        agentId: agent.id,
        conversationId: conversation.id,
        userId: "audience-2",
        question: "Read someone else's history",
        idempotencyKey: "request-forbidden",
      }),
    ).toThrowError(/does not belong/i);
  });

  it("replays an idempotent request without duplicating messages", () => {
    const { engine, agent } = createPublishedFixture();
    const conversation = engine.createConversation(agent.id, "audience-1");
    const request = {
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience-1",
      question: "How often should I publish?",
      idempotencyKey: "same-request",
    };

    const first = engine.sendMessage(request);
    const second = engine.sendMessage(request);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.assistantMessage.id).toBe(first.assistantMessage.id);
    expect(engine.getConversation(conversation.id, "audience-1").messages).toHaveLength(2);
  });

  it("immediately removes deleted source content from retrieval", () => {
    const { engine, agent, publicSource } = createPublishedFixture();
    engine.deleteSource("creator-a", publicSource.id);
    const conversation = engine.createConversation(agent.id, "audience-1");
    const result = engine.sendMessage({
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience-1",
      question: "What publishing cadence is sustainable?",
      idempotencyKey: "after-delete",
    });

    expect(result.assistantMessage.citations).toEqual([]);
  });

  it("versions creator style changes and applies them to local answers", () => {
    const { engine, agent } = createPublishedFixture();
    const updated = engine.updateAgent("creator-a", agent.id, {
      stylePreset: "direct",
      responseLength: "short",
      tone: "Direct and concise",
      signaturePhrases: ["Make the next step small."],
      prohibitedTopics: ["Individual financial advice"],
    });
    const conversation = engine.createConversation(agent.id, "audience-style");
    const result = engine.sendMessage({
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience-style",
      question: "How should I create a sustainable publishing cadence and repurpose it?",
      idempotencyKey: "styled",
    });

    expect(updated.version).toBeGreaterThan(agent.version);
    expect(result.assistantMessage.content).toMatch(/^Start here:/);
    expect(result.assistantMessage.content).toContain("Make the next step small.");
    expect(result.assistantMessage.citations).toHaveLength(1);
  });

  it("stages a validated video without making it retrievable before transcription", () => {
    const { engine, agent } = createPublishedFixture();
    const video = engine.stageVideoSource({
      ownerId: "creator-a",
      agentId: agent.id,
      title: "Creator workshop",
      fileName: "workshop.mp4",
      mimeType: "video/mp4",
      size: 42_000_000,
      visibility: "public",
    });
    const conversation = engine.createConversation(agent.id, "audience-video");
    const result = engine.sendMessage({
      agentId: agent.id,
      conversationId: conversation.id,
      userId: "audience-video",
      question: "What does the creator workshop say about camera setup?",
      idempotencyKey: "video-still-processing",
    });

    expect(video.status).toBe("processing");
    expect(video.chunks).toEqual([]);
    expect(result.assistantMessage.citations).not.toContainEqual(
      expect.objectContaining({ sourceId: video.id }),
    );
  });

  it("rejects unsupported or oversized video files", () => {
    const { engine, agent } = createPublishedFixture();
    const base = {
      ownerId: "creator-a",
      agentId: agent.id,
      title: "Creator workshop",
      fileName: "workshop.avi",
      visibility: "preview" as const,
    };

    expect(() => engine.stageVideoSource({ ...base, mimeType: "video/x-msvideo", size: 10_000 }))
      .toThrowError(/MP4, WebM, or QuickTime/i);
    expect(() => engine.stageVideoSource({ ...base, mimeType: "video/mp4", size: 250_000_001 }))
      .toThrowError(/250 MB/i);
  });
});
