export type SourceKind = "document" | "audio" | "video";
export type SourceVisibility = "public" | "preview";
export type SourceStatus = "processing" | "ready" | "disabled" | "deleted";
export type AgentStatus = "draft" | "published";
export type StylePreset = "warm" | "direct" | "curious" | "custom";
export type ResponseLength = "short" | "balanced" | "deep";

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  handle: string;
  description: string;
  tone: string;
  stylePreset: StylePreset;
  responseLength: ResponseLength;
  signaturePhrases: string[];
  prohibitedTopics: string[];
  boundaries: string;
  greeting: string;
  status: AgentStatus;
  version: number;
}

export interface Chunk {
  id: string;
  sourceId: string;
  text: string;
  location: string;
}

export interface Source {
  id: string;
  agentId: string;
  ownerId: string;
  title: string;
  kind: SourceKind;
  visibility: SourceVisibility;
  status: SourceStatus;
  size: number;
  processingDetail?: string;
  chunks: Chunk[];
}

export interface Citation {
  sourceId: string;
  title: string;
  excerpt: string;
  location: string;
}

export interface Message {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
}

export interface Conversation {
  id: string;
  agentId: string;
  userId: string;
  messages: Message[];
}

export interface ChatResult {
  userMessage: Message;
  assistantMessage: Message;
  replayed: boolean;
}

export interface AgentGenerationInput {
  agent: Agent;
  question: string;
  conversationId: string;
  history: Message[];
  context: Citation[];
}

export interface AgentGenerationOutput {
  answer: string;
  citedSourceIds?: string[];
}

export type AgentGenerator = (
  input: AgentGenerationInput,
) => Promise<AgentGenerationOutput>;

export interface RemoteAgentRouteConfig {
  endpoint: string;
  bearerToken?: string;
  timeoutMs?: number;
}

export interface RemoteAgentRequest {
  version: "2026-08-24";
  agent: {
    id: string;
    name: string;
    instructions: string;
  };
  conversation: {
    id: string;
    history: Message[];
  };
  message: {
    content: string;
  };
  context: Citation[];
}

export interface RemoteAgentResponse {
  answer: string;
  citations?: string[];
  provider?: string;
}

export interface LoadSimulationInput {
  activeUsers: number;
  messagesPerUser: number;
  agentCount: number;
  popularAgentShare: number;
  platformConcurrency: number;
  perAgentConcurrency: number;
  maxQueuePerAgent: number;
  serviceTimeMs: number;
}

export interface AgentLoadResult {
  agentId: string;
  requested: number;
  completed: number;
  rejected: number;
  maxLatencyMs: number;
}

export interface LoadSimulationResult {
  totalRequests: number;
  completed: number;
  rejected: number;
  peakConcurrency: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  fairnessIndex: number;
  timeline: Array<{ timeMs: number; active: number; completed: number }>;
  agents: AgentLoadResult[];
}
