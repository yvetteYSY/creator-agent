export type SourceKind = "document" | "audio" | "video";
export type SourceVisibility = "public" | "preview";
export type SourceStatus = "ready" | "disabled" | "deleted";
export type AgentStatus = "draft" | "published";

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  handle: string;
  description: string;
  tone: string;
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
