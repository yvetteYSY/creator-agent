const MAX_WEBVTT_BYTES = 2_000_000;
const MAX_WEBVTT_CUES = 10_000;

export interface WebVttCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface WebVttDocument {
  normalized: string;
  cues: WebVttCue[];
  durationMs: number;
}

export class WebVttValidationError extends Error {}

export function parseWebVtt(transcript: string): WebVttDocument {
  if (new TextEncoder().encode(transcript).byteLength > MAX_WEBVTT_BYTES) {
    throw new WebVttValidationError("WebVTT transcripts must be 2 MB or smaller.");
  }
  const normalized = transcript.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = normalized.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine !== "WEBVTT" && !firstLine.startsWith("WEBVTT ")) {
    throw new WebVttValidationError("Choose a valid WebVTT transcript.");
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
    const startMs = parseTimestamp(rawStart);
    const endMs = parseTimestamp(rawEnd);
    if (startMs === null || endMs === null || endMs <= startMs) {
      throw new WebVttValidationError("WebVTT contains an invalid timestamp range.");
    }
    if (startMs < previousStart) {
      throw new WebVttValidationError("WebVTT caption cues must be chronological.");
    }
    const text = decodeText(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;
    cues.push({ startMs, endMs, text });
    previousStart = startMs;
    if (cues.length > MAX_WEBVTT_CUES) {
      throw new WebVttValidationError("WebVTT transcripts may contain at most 10,000 caption cues.");
    }
  }
  if (cues.length === 0) {
    throw new WebVttValidationError("WebVTT must contain at least one caption cue.");
  }
  return { normalized, cues, durationMs: Math.max(...cues.map((cue) => cue.endMs)) };
}

function parseTimestamp(value: string): number | null {
  const match = value.match(/^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})$/);
  if (!match) return null;
  const [, rawHours, rawMinutes, rawSeconds, rawMilliseconds] = match;
  const result = (((Number(rawHours ?? 0) * 60) + Number(rawMinutes)) * 60
    + Number(rawSeconds)) * 1_000 + Number(rawMilliseconds);
  return Number.isSafeInteger(result) ? result : null;
}

function decodeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
