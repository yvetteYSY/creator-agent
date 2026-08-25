import { describe, expect, it } from "vitest";
import { simulateConcurrentChat } from "../src";

describe("simulateConcurrentChat", () => {
  it("completes traffic within configured platform and agent concurrency", () => {
    const result = simulateConcurrentChat({
      activeUsers: 20,
      messagesPerUser: 2,
      agentCount: 4,
      popularAgentShare: 0.5,
      platformConcurrency: 8,
      perAgentConcurrency: 3,
      maxQueuePerAgent: 100,
      serviceTimeMs: 500,
    });

    expect(result.totalRequests).toBe(40);
    expect(result.completed).toBe(40);
    expect(result.rejected).toBe(0);
    expect(result.peakConcurrency).toBeLessThanOrEqual(8);
    expect(result.timeline.at(-1)?.completed).toBe(40);
  });

  it("rejects excess work instead of creating an unbounded hot-agent queue", () => {
    const result = simulateConcurrentChat({
      activeUsers: 100,
      messagesPerUser: 1,
      agentCount: 2,
      popularAgentShare: 0.9,
      platformConcurrency: 10,
      perAgentConcurrency: 5,
      maxQueuePerAgent: 10,
      serviceTimeMs: 500,
    });

    const popular = result.agents[0];
    expect(popular.requested).toBe(90);
    expect(popular.completed).toBe(15);
    expect(popular.rejected).toBe(75);
    expect(result.rejected).toBeGreaterThan(0);
  });

  it("keeps service fair when one agent receives most traffic", () => {
    const result = simulateConcurrentChat({
      activeUsers: 60,
      messagesPerUser: 1,
      agentCount: 3,
      popularAgentShare: 0.8,
      platformConcurrency: 6,
      perAgentConcurrency: 2,
      maxQueuePerAgent: 100,
      serviceTimeMs: 250,
    });

    expect(result.agents.slice(1).every((agent) => agent.completed === agent.requested)).toBe(true);
    expect(result.fairnessIndex).toBe(1);
  });
});
