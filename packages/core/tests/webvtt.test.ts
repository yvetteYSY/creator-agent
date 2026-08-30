import { describe, expect, it } from "vitest";
import { parseWebVtt, WebVttValidationError } from "../src/webvtt";

describe("shared WebVTT validation", () => {
  it("normalizes line endings and returns bounded cue metadata", () => {
    const parsed = parseWebVtt("\uFEFFWEBVTT\r\n\r\n00:00.000 --> 00:02.500\r\nHello <b>creator</b> &amp; audience");
    expect(parsed.normalized).toContain("WEBVTT\n\n");
    expect(parsed.cues).toEqual([{
      startMs: 0,
      endMs: 2_500,
      text: "Hello creator & audience",
    }]);
    expect(parsed.durationMs).toBe(2_500);
  });

  it("rejects non-caption content", () => {
    expect(() => parseWebVtt("not captions")).toThrowError(WebVttValidationError);
  });
});
