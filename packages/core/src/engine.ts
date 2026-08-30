import type {
  Agent,
  AgentGenerator,
  AgentGenerationInput,
  ChatResult,
  Chunk,
  Citation,
  Conversation,
  Message,
  Source,
  SourceKind,
  SourceVisibility,
  ResponseLength,
  StylePreset,
} from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "with",
  "you",
  "your",
]);

export class CreatorAgentError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID_STATE"
      | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "CreatorAgentError";
  }
}

function normalizeTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function createChunks(sourceId: string, content: string): Chunk[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const units = paragraphs.length > 0 ? paragraphs : [content.trim()];
  return units.map((text, index) => ({
    id: `${sourceId}:chunk:${index + 1}`,
    sourceId,
    text,
    location: `Section ${index + 1}`,
  }));
}

const MAX_WEBVTT_BYTES = 2_000_000;
const MAX_WEBVTT_CUES = 10_000;

interface WebVttCue {
  startMs: number;
  endMs: number;
  text: string;
}

function parseWebVttTimestamp(value: string): number | null {
  const match = value.match(/^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})$/);
  if (!match) return null;
  const [, rawHours, rawMinutes, rawSeconds, rawMilliseconds] = match;
  const hours = Number(rawHours ?? 0);
  const minutes = Number(rawMinutes);
  const seconds = Number(rawSeconds);
  const milliseconds = Number(rawMilliseconds);
  const result = (((hours * 60) + minutes) * 60 + seconds) * 1_000 + milliseconds;
  return Number.isSafeInteger(result) ? result : null;
}

function decodeWebVttText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWebVtt(transcript: string): WebVttCue[] {
  if (new TextEncoder().encode(transcript).byteLength > MAX_WEBVTT_BYTES) {
    throw new CreatorAgentError("INVALID_INPUT", "WebVTT transcripts must be 2 MB or smaller.");
  }
  const normalized = transcript.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = normalized.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine !== "WEBVTT" && !firstLine.startsWith("WEBVTT ")) {
    throw new CreatorAgentError("INVALID_INPUT", "Choose a valid WebVTT transcript.");
  }

  const cues: WebVttCue[] = [];
  const blocks = normalized.split(/\n{2,}/).slice(1);
  let previousStart = -1;
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const timingIndex = lines[0].includes("-->") ? 0 : 1;
    const timing = lines[timingIndex];
    if (!timing?.includes("-->")) continue;
    const [rawStart, rawEndWithSettings] = timing.split("-->", 2).map((value) => value.trim());
    const rawEnd = rawEndWithSettings?.split(/\s+/, 1)[0] ?? "";
    const startMs = parseWebVttTimestamp(rawStart);
    const endMs = parseWebVttTimestamp(rawEnd);
    if (startMs === null || endMs === null || endMs <= startMs) {
      throw new CreatorAgentError("INVALID_INPUT", "WebVTT contains an invalid timestamp range.");
    }
    if (startMs < previousStart) {
      throw new CreatorAgentError("INVALID_INPUT", "WebVTT caption cues must be chronological.");
    }
    const text = decodeWebVttText(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;
    cues.push({ startMs, endMs, text });
    previousStart = startMs;
    if (cues.length > MAX_WEBVTT_CUES) {
      throw new CreatorAgentError("INVALID_INPUT", "WebVTT transcripts may contain at most 10,000 caption cues.");
    }
  }
  if (cues.length === 0) {
    throw new CreatorAgentError("INVALID_INPUT", "WebVTT must contain at least one caption cue.");
  }
  return cues;
}

function timestampLabel(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function scoreChunk(questionTerms: string[], chunk: Chunk): number {
  const terms = new Set(normalizeTerms(chunk.text));
  return questionTerms.reduce(
    (score, term) => score + (terms.has(term) ? 1 : 0),
    0,
  );
}

function excerpt(text: string, maxLength = 180): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

export class CreatorAgentEngine {
  private sequence = 0;
  private readonly agents = new Map<string, Agent>();
  private readonly sources = new Map<string, Source>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly requestResults = new Map<string, ChatResult>();
  private readonly pendingRequests = new Map<string, Promise<ChatResult>>();

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(4, "0")}`;
  }

  createAgent(input: {
    ownerId: string;
    name: string;
    handle: string;
    description?: string;
    tone?: string;
    stylePreset?: StylePreset;
    responseLength?: ResponseLength;
    signaturePhrases?: string[];
    prohibitedTopics?: string[];
    boundaries?: string;
    greeting?: string;
  }): Agent {
    if (!input.ownerId.trim() || !input.name.trim() || !input.handle.trim()) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "Owner, agent name, and handle are required.",
      );
    }

    const agent: Agent = {
      id: this.nextId("agent"),
      ownerId: input.ownerId,
      name: input.name.trim(),
      handle: input.handle.trim().replace(/^@/, ""),
      description: input.description?.trim() ?? "",
      tone: input.tone?.trim() || "Clear, warm, and practical",
      stylePreset: input.stylePreset ?? "warm",
      responseLength: input.responseLength ?? "balanced",
      signaturePhrases: input.signaturePhrases?.map((phrase) => phrase.trim()).filter(Boolean) ?? [],
      prohibitedTopics: input.prohibitedTopics?.map((topic) => topic.trim()).filter(Boolean) ?? [],
      boundaries:
        input.boundaries?.trim() ||
        "Do not invent personal opinions or answer outside approved sources.",
      greeting:
        input.greeting?.trim() ||
        "Ask me anything about the creator's published content.",
      status: "draft",
      version: 1,
    };

    this.agents.set(agent.id, agent);
    return structuredClone(agent);
  }

  getAgent(agentId: string): Agent {
    return structuredClone(this.requireAgent(agentId));
  }

  updateAgent(
    ownerId: string,
    agentId: string,
    patch: Partial<Pick<Agent, "name" | "description" | "tone" | "stylePreset" | "responseLength" | "signaturePhrases" | "prohibitedTopics" | "boundaries" | "greeting">>,
  ): Agent {
    const agent = this.requireOwnedAgent(ownerId, agentId);
    Object.assign(agent, patch, { version: agent.version + 1 });
    return structuredClone(agent);
  }

  addSource(input: {
    ownerId: string;
    agentId: string;
    title: string;
    kind: SourceKind;
    content: string;
    visibility: SourceVisibility;
  }): Source {
    this.requireOwnedAgent(input.ownerId, input.agentId);
    if (!input.title.trim() || input.content.trim().length < 20) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "A title and at least 20 characters of source content are required.",
      );
    }

    const sourceId = this.nextId("source");
    const source: Source = {
      id: sourceId,
      agentId: input.agentId,
      ownerId: input.ownerId,
      title: input.title.trim(),
      kind: input.kind,
      visibility: input.visibility,
      status: "ready",
      size: input.content.length,
      chunks: createChunks(sourceId, input.content),
    };
    this.sources.set(sourceId, source);
    return structuredClone(source);
  }

  stageVideoSource(input: {
    ownerId: string;
    agentId: string;
    title: string;
    fileName: string;
    mimeType: string;
    size: number;
    visibility: SourceVisibility;
  }): Source {
    this.requireOwnedAgent(input.ownerId, input.agentId);
    const allowedTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);
    if (!input.title.trim() || !input.fileName.trim()) {
      throw new CreatorAgentError("INVALID_INPUT", "A video file and title are required.");
    }
    if (!allowedTypes.has(input.mimeType)) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "Use an MP4, WebM, or QuickTime video.",
      );
    }
    if (!Number.isFinite(input.size) || input.size <= 0 || input.size > 250_000_000) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "Video size must be between 1 byte and 250 MB.",
      );
    }

    const sourceId = this.nextId("source");
    const source: Source = {
      id: sourceId,
      agentId: input.agentId,
      ownerId: input.ownerId,
      title: input.title.trim(),
      kind: "video",
      visibility: input.visibility,
      status: "processing",
      size: input.size,
      processingDetail: "Awaiting a creator-owned or self-hosted transcription route",
      chunks: [],
    };
    this.sources.set(sourceId, source);
    return structuredClone(source);
  }

  ingestTranscribedVideoSource(input: {
    ownerId: string;
    agentId: string;
    title: string;
    fileName: string;
    mimeType: string;
    size: number;
    visibility: SourceVisibility;
    transcript: string;
  }): Source {
    const cues = parseWebVtt(input.transcript);
    const staged = this.stageVideoSource(input);
    const source = this.requireSource(staged.id);
    source.status = "ready";
    delete source.processingDetail;
    source.chunks = cues.map((cue, index) => ({
      id: `${source.id}:chunk:${index + 1}`,
      sourceId: source.id,
      text: cue.text,
      location: `${timestampLabel(cue.startMs)}–${timestampLabel(cue.endMs)}`,
    }));
    return structuredClone(source);
  }

  listSources(ownerId: string, agentId: string): Source[] {
    this.requireOwnedAgent(ownerId, agentId);
    return [...this.sources.values()]
      .filter((source) => source.agentId === agentId && source.status !== "deleted")
      .map((source) => structuredClone(source));
  }

  setSourceVisibility(
    ownerId: string,
    sourceId: string,
    visibility: SourceVisibility,
  ): Source {
    const source = this.requireSource(sourceId);
    if (source.ownerId !== ownerId) {
      throw new CreatorAgentError("FORBIDDEN", "The source belongs to another creator.");
    }
    source.visibility = visibility;
    return structuredClone(source);
  }

  deleteSource(ownerId: string, sourceId: string): void {
    const source = this.requireSource(sourceId);
    if (source.ownerId !== ownerId) {
      throw new CreatorAgentError("FORBIDDEN", "The source belongs to another creator.");
    }
    source.status = "deleted";
    source.chunks = [];
  }

  publishAgent(ownerId: string, agentId: string): Agent {
    const agent = this.requireOwnedAgent(ownerId, agentId);
    const publicSources = [...this.sources.values()].filter(
      (source) =>
        source.agentId === agentId &&
        source.status === "ready" &&
        source.visibility === "public",
    );
    if (publicSources.length === 0) {
      throw new CreatorAgentError(
        "INVALID_STATE",
        "At least one ready source approved for public answers is required.",
      );
    }
    agent.status = "published";
    agent.version += 1;
    return structuredClone(agent);
  }

  createConversation(agentId: string, userId: string): Conversation {
    const agent = this.requireAgent(agentId);
    if (agent.status !== "published") {
      throw new CreatorAgentError("INVALID_STATE", "The agent is not published.");
    }
    if (!userId.trim()) {
      throw new CreatorAgentError("INVALID_INPUT", "A user or session id is required.");
    }
    const conversation: Conversation = {
      id: this.nextId("conversation"),
      agentId,
      userId,
      messages: [],
    };
    this.conversations.set(conversation.id, conversation);
    return structuredClone(conversation);
  }

  getConversation(conversationId: string, userId: string): Conversation {
    const conversation = this.requireConversation(conversationId);
    if (conversation.userId !== userId) {
      throw new CreatorAgentError(
        "FORBIDDEN",
        "A conversation can only be opened by its audience member.",
      );
    }
    return structuredClone(conversation);
  }

  sendMessage(input: {
    agentId: string;
    conversationId: string;
    userId: string;
    question: string;
    idempotencyKey: string;
  }): ChatResult {
    const agent = this.requireAgent(input.agentId);
    if (agent.status !== "published") {
      throw new CreatorAgentError("INVALID_STATE", "The agent is not published.");
    }

    const conversation = this.requireConversation(input.conversationId);
    if (conversation.agentId !== input.agentId || conversation.userId !== input.userId) {
      throw new CreatorAgentError(
        "FORBIDDEN",
        "The conversation does not belong to this agent and audience member.",
      );
    }
    if (!input.question.trim() || !input.idempotencyKey.trim()) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "A question and idempotency key are required.",
      );
    }

    const requestKey = `${conversation.id}:${input.idempotencyKey}`;
    const previous = this.requestResults.get(requestKey);
    if (previous) {
      return { ...structuredClone(previous), replayed: true };
    }

    const userMessage: Message = {
      id: this.nextId("message"),
      sequence: conversation.messages.length + 1,
      role: "user",
      content: input.question.trim(),
      citations: [],
    };
    conversation.messages.push(userMessage);

    const matches = this.retrieve(input.agentId, input.question);
    const citationLimit = agent.responseLength === "short" ? 1 : agent.responseLength === "deep" ? 4 : 2;
    const citations: Citation[] = matches.slice(0, citationLimit).map(({ source, chunk }) => ({
      sourceId: source.id,
      title: source.title,
      excerpt: excerpt(chunk.text),
      location: chunk.location,
    }));

    const lead =
      agent.stylePreset === "direct"
        ? "Start here:"
        : agent.stylePreset === "curious"
          ? "A useful way to think about it:"
          : agent.stylePreset === "warm"
            ? "Let's make this practical:"
            : "Based on the approved content:";
    const signature = agent.signaturePhrases[0]
      ? ` ${agent.signaturePhrases[0]}`
      : "";
    const content =
      citations.length > 0
        ? `${lead} ${citations
            .map((citation) => citation.excerpt)
            .join(" ")}${signature}`
        : `I don't have enough information in ${agent.name}'s approved sources to answer that yet.`;

    const assistantMessage: Message = {
      id: this.nextId("message"),
      sequence: conversation.messages.length + 1,
      role: "assistant",
      content,
      citations,
    };
    conversation.messages.push(assistantMessage);

    const result: ChatResult = {
      userMessage: structuredClone(userMessage),
      assistantMessage: structuredClone(assistantMessage),
      replayed: false,
    };
    this.requestResults.set(requestKey, result);
    return structuredClone(result);
  }

  async sendMessageWithGenerator(
    input: {
      agentId: string;
      conversationId: string;
      userId: string;
      question: string;
      idempotencyKey: string;
    },
    generator: AgentGenerator,
  ): Promise<ChatResult> {
    const { agent, conversation, requestKey } = this.validateMessageRequest(input);
    const previous = this.requestResults.get(requestKey);
    if (previous) return { ...structuredClone(previous), replayed: true };

    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      const result = await pending;
      return { ...structuredClone(result), replayed: true };
    }

    const generation = this.generateWithRemoteAgent(
      input,
      agent,
      conversation,
      requestKey,
      generator,
    );
    this.pendingRequests.set(requestKey, generation);

    try {
      return structuredClone(await generation);
    } finally {
      this.pendingRequests.delete(requestKey);
    }
  }

  private async generateWithRemoteAgent(
    input: {
      agentId: string;
      conversationId: string;
      userId: string;
      question: string;
      idempotencyKey: string;
    },
    agent: Agent,
    conversation: Conversation,
    requestKey: string,
    generator: AgentGenerator,
  ): Promise<ChatResult> {
    const matches = this.retrieve(input.agentId, input.question);
    const approvedContext: Citation[] = matches.slice(0, 4).map(({ source, chunk }) => ({
      sourceId: source.id,
      title: source.title,
      excerpt: excerpt(chunk.text),
      location: chunk.location,
    }));
    const generationInput: AgentGenerationInput = {
      agent: structuredClone(agent),
      question: input.question.trim(),
      conversationId: conversation.id,
      history: structuredClone(conversation.messages.slice(-10)),
      context: structuredClone(approvedContext),
    };
    const generated = await generator(generationInput);
    if (!generated.answer?.trim()) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "The routed agent returned an empty answer.",
      );
    }

    const citedSourceIds = new Set(generated.citedSourceIds ?? []);
    const citations = approvedContext.filter((citation) =>
      citedSourceIds.has(citation.sourceId),
    );
    const userMessage: Message = {
      id: this.nextId("message"),
      sequence: conversation.messages.length + 1,
      role: "user",
      content: input.question.trim(),
      citations: [],
    };
    const assistantMessage: Message = {
      id: this.nextId("message"),
      sequence: conversation.messages.length + 2,
      role: "assistant",
      content: generated.answer.trim(),
      citations,
    };
    conversation.messages.push(userMessage, assistantMessage);

    const result: ChatResult = {
      userMessage: structuredClone(userMessage),
      assistantMessage: structuredClone(assistantMessage),
      replayed: false,
    };
    this.requestResults.set(requestKey, result);
    return result;
  }

  private validateMessageRequest(input: {
    agentId: string;
    conversationId: string;
    userId: string;
    question: string;
    idempotencyKey: string;
  }) {
    const agent = this.requireAgent(input.agentId);
    if (agent.status !== "published") {
      throw new CreatorAgentError("INVALID_STATE", "The agent is not published.");
    }
    const conversation = this.requireConversation(input.conversationId);
    if (conversation.agentId !== input.agentId || conversation.userId !== input.userId) {
      throw new CreatorAgentError(
        "FORBIDDEN",
        "The conversation does not belong to this agent and audience member.",
      );
    }
    if (!input.question.trim() || !input.idempotencyKey.trim()) {
      throw new CreatorAgentError(
        "INVALID_INPUT",
        "A question and idempotency key are required.",
      );
    }
    return {
      agent,
      conversation,
      requestKey: `${conversation.id}:${input.idempotencyKey}`,
    };
  }

  private retrieve(agentId: string, question: string) {
    const questionTerms = normalizeTerms(question);
    return [...this.sources.values()]
      .filter(
        (source) =>
          source.agentId === agentId &&
          source.status === "ready" &&
          source.visibility === "public",
      )
      .flatMap((source) =>
        source.chunks.map((chunk) => ({
          source,
          chunk,
          score: scoreChunk(questionTerms, chunk),
        })),
      )
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new CreatorAgentError("NOT_FOUND", "Agent not found.");
    return agent;
  }

  private requireOwnedAgent(ownerId: string, agentId: string): Agent {
    const agent = this.requireAgent(agentId);
    if (agent.ownerId !== ownerId) {
      throw new CreatorAgentError("FORBIDDEN", "The agent belongs to another creator.");
    }
    return agent;
  }

  private requireSource(sourceId: string): Source {
    const source = this.sources.get(sourceId);
    if (!source) throw new CreatorAgentError("NOT_FOUND", "Source not found.");
    return source;
  }

  private requireConversation(conversationId: string): Conversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new CreatorAgentError("NOT_FOUND", "Conversation not found.");
    }
    return conversation;
  }
}
