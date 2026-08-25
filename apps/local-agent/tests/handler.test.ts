import { describe, expect, it } from "vitest";
import { handleLocalAgentRequest, LocalAgentRequestError } from "../src/handler";

describe("local reference agent", () => {
  it("returns a cited answer using only supplied approved context", () => {
    const response = handleLocalAgentRequest({
      version: "2026-08-24",
      agent: { id: "agent", name: "Coach", instructions: "Be useful." },
      conversation: { id: "conversation", history: [] },
      message: { content: "How often should I publish?" },
      context: [
        {
          sourceId: "source-public",
          title: "Publishing guide",
          excerpt: "Publish one durable idea every week.",
          location: "Section 1",
        },
      ],
    });

    expect(response.answer).toContain("Publish one durable idea every week");
    expect(response.citations).toEqual(["source-public"]);
    expect(response.provider).toBe("local-reference-agent");
  });

  it("refuses malformed payloads and does not invent missing context", () => {
    expect(() => handleLocalAgentRequest({ context: [] })).toThrowError(
      LocalAgentRequestError,
    );
    expect(
      handleLocalAgentRequest({
        version: "2026-08-24",
        message: { content: "Secret?" },
        context: [],
      }).citations,
    ).toEqual([]);
  });
});
