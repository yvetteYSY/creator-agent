import type {
  AgentLoadResult,
  LoadSimulationInput,
  LoadSimulationResult,
} from "./types";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const index = Math.ceil(clamp(value, 0, 1) * values.length) - 1;
  return [...values].sort((left, right) => left - right)[Math.max(0, index)];
}

function jainFairness(values: number[]): number {
  if (values.length === 0) return 1;
  const sum = values.reduce((total, value) => total + value, 0);
  const squares = values.reduce((total, value) => total + value * value, 0);
  return squares === 0 ? 1 : (sum * sum) / (values.length * squares);
}

export function simulateConcurrentChat(raw: LoadSimulationInput): LoadSimulationResult {
  const input: LoadSimulationInput = {
    activeUsers: Math.round(clamp(raw.activeUsers, 1, 100_000)),
    messagesPerUser: Math.round(clamp(raw.messagesPerUser, 1, 100)),
    agentCount: Math.round(clamp(raw.agentCount, 1, 1_000)),
    popularAgentShare: clamp(raw.popularAgentShare, 0, 1),
    platformConcurrency: Math.round(clamp(raw.platformConcurrency, 1, 10_000)),
    perAgentConcurrency: Math.round(clamp(raw.perAgentConcurrency, 1, 1_000)),
    maxQueuePerAgent: Math.round(clamp(raw.maxQueuePerAgent, 0, 100_000)),
    serviceTimeMs: Math.round(clamp(raw.serviceTimeMs, 50, 120_000)),
  };

  const totalRequests = input.activeUsers * input.messagesPerUser;
  const popularRequests =
    input.agentCount === 1
      ? totalRequests
      : Math.round(totalRequests * input.popularAgentShare);
  const remainingRequests = totalRequests - popularRequests;
  const requestsByAgent = Array.from({ length: input.agentCount }, (_, index) => {
    if (index === 0) return popularRequests;
    const peers = input.agentCount - 1;
    const base = Math.floor(remainingRequests / peers);
    return base + (index - 1 < remainingRequests % peers ? 1 : 0);
  });

  const admittedByAgent = requestsByAgent.map((requested) =>
    Math.min(requested, input.perAgentConcurrency + input.maxQueuePerAgent),
  );
  const queues = [...admittedByAgent];
  const completedByAgent = Array(input.agentCount).fill(0) as number[];
  const maxLatencyByAgent = Array(input.agentCount).fill(0) as number[];
  const latencies: number[] = [];
  const timeline: LoadSimulationResult["timeline"] = [];
  let timeMs = 0;
  let completed = 0;
  let peakConcurrency = 0;
  let cursor = 0;

  while (queues.some((queued) => queued > 0)) {
    let available = input.platformConcurrency;
    let active = 0;
    let visited = 0;

    while (available > 0 && visited < input.agentCount) {
      const agentIndex = (cursor + visited) % input.agentCount;
      const started = Math.min(
        queues[agentIndex],
        input.perAgentConcurrency,
        available,
      );
      queues[agentIndex] -= started;
      completedByAgent[agentIndex] += started;
      active += started;
      available -= started;
      visited += 1;

      for (let index = 0; index < started; index += 1) {
        const latency = timeMs + input.serviceTimeMs;
        latencies.push(latency);
        maxLatencyByAgent[agentIndex] = latency;
      }
    }

    if (active === 0) break;
    peakConcurrency = Math.max(peakConcurrency, active);
    timeMs += input.serviceTimeMs;
    completed += active;
    timeline.push({ timeMs, active, completed });
    cursor = (cursor + 1) % input.agentCount;
  }

  const agents: AgentLoadResult[] = requestsByAgent.map((requested, index) => ({
    agentId: index === 0 ? "popular-agent" : `agent-${index + 1}`,
    requested,
    completed: completedByAgent[index],
    rejected: requested - admittedByAgent[index],
    maxLatencyMs: maxLatencyByAgent[index],
  }));
  const rejected = totalRequests - completed;
  const normalizedShares = agents
    .filter((agent) => agent.requested > 0)
    .map((agent) => agent.completed / agent.requested);

  return {
    totalRequests,
    completed,
    rejected,
    peakConcurrency,
    averageLatencyMs:
      latencies.length === 0
        ? 0
        : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95LatencyMs: percentile(latencies, 0.95),
    fairnessIndex: Number(jainFairness(normalizedShares).toFixed(3)),
    timeline,
    agents,
  };
}
