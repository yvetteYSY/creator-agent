import type { ObjectStorage } from "./object-storage";
import type { ScanJob, ScanRepository } from "./scanner-store";

const INSPECTION_WINDOW_BYTES = 512 * 1024;
const MAX_ATTEMPTS = 3;
const STALE_LEASE_MILLISECONDS = 15 * 60 * 1000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 4 * 60 * 60 * 1_000;
const MP4_BRANDS = new Set([
  "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom",
  "M4V ", "mp41", "mp42", "MSNV",
]);
const VIDEO_CODECS = new Set(["avc1", "avc3"]);
const AUDIO_CODECS = new Set(["mp4a"]);

export type ScanRunResult =
  | { outcome: "idle" }
  | {
    outcome: "passed";
    sourceId: string;
    detectedMediaType: "video/mp4";
    durationMs: number;
    videoCodec: string;
    audioCodec: string;
  }
  | { outcome: "failed"; sourceId: string; failureCode: string };

export interface Mp4SignatureResult {
  valid: boolean;
  failureCode?: "media_too_small" | "invalid_mp4_box" | "unsupported_mp4_brand";
}

type Mp4InspectionFailureCode = NonNullable<Mp4SignatureResult["failureCode"]>
  | "mp4_metadata_not_found"
  | "invalid_mp4_metadata"
  | "media_duration_out_of_range"
  | "missing_video_track"
  | "unsupported_video_codec"
  | "missing_audio_track"
  | "unsupported_audio_codec";

export type Mp4InspectionResult = {
  valid: true;
  durationMs: number;
  videoCodec: string;
  audioCodec: string;
} | {
  valid: false;
  failureCode: Mp4InspectionFailureCode;
};

interface BoxView {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
}

interface TrackMetadata {
  handlerType: string;
  codec?: string;
}

export function validateMp4Prefix(prefix: Uint8Array): Mp4SignatureResult {
  if (prefix.byteLength < 16) return { valid: false, failureCode: "media_too_small" };
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const boxSize = view.getUint32(0, false);
  const boxType = ascii(prefix, 4, 8);
  if (boxType !== "ftyp" || boxSize < 16 || boxSize > prefix.byteLength || boxSize % 4 !== 0) {
    return { valid: false, failureCode: "invalid_mp4_box" };
  }
  const brands = [ascii(prefix, 8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(ascii(prefix, offset, offset + 4));
  }
  if (!brands.some((brand) => MP4_BRANDS.has(brand))) {
    return { valid: false, failureCode: "unsupported_mp4_brand" };
  }
  return { valid: true };
}

export function inspectMp4(
  head: Uint8Array,
  tail: Uint8Array,
  totalSize: number,
): Mp4InspectionResult {
  const signature = validateMp4Prefix(head);
  if (!signature.valid) {
    return { valid: false, failureCode: signature.failureCode ?? "invalid_mp4_box" };
  }
  const effectiveSize = totalSize > 0 ? totalSize : head.byteLength;
  const moov = findTopLevelMovieBox(head, tail, effectiveSize);
  if (!moov) return { valid: false, failureCode: "mp4_metadata_not_found" };

  const moovBytes = moov.bytes;
  const children = readChildBoxes(moovBytes, moov.box.payloadStart, moov.box.end);
  if (!children) return { valid: false, failureCode: "invalid_mp4_metadata" };
  const movieHeader = children.find((box) => box.type === "mvhd");
  if (!movieHeader) return { valid: false, failureCode: "invalid_mp4_metadata" };
  const durationMs = readMovieDuration(moovBytes, movieHeader);
  if (durationMs === null) return { valid: false, failureCode: "invalid_mp4_metadata" };
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    return { valid: false, failureCode: "media_duration_out_of_range" };
  }

  const tracks: TrackMetadata[] = [];
  for (const trackBox of children.filter((box) => box.type === "trak")) {
    const track = readTrackMetadata(moovBytes, trackBox);
    if (track) tracks.push(track);
  }
  const videoTracks = tracks.filter((track) => track.handlerType === "vide");
  if (videoTracks.length === 0) return { valid: false, failureCode: "missing_video_track" };
  const videoCodec = videoTracks.find((track) => track.codec && VIDEO_CODECS.has(track.codec))?.codec;
  if (!videoCodec) return { valid: false, failureCode: "unsupported_video_codec" };
  const audioTracks = tracks.filter((track) => track.handlerType === "soun");
  if (audioTracks.length === 0) return { valid: false, failureCode: "missing_audio_track" };
  const audioCodec = audioTracks.find((track) => track.codec && AUDIO_CODECS.has(track.codec))?.codec;
  if (!audioCodec) return { valid: false, failureCode: "unsupported_audio_codec" };
  return { valid: true, durationMs, videoCodec, audioCodec };
}

export async function runScanOnce(input: {
  repository: ScanRepository;
  storage: ObjectStorage;
  now?: Date;
}): Promise<ScanRunResult> {
  const now = input.now ?? new Date();
  const job = await input.repository.claimNext({
    staleBefore: new Date(now.getTime() - STALE_LEASE_MILLISECONDS),
    maxAttempts: MAX_ATTEMPTS,
  });
  if (!job) return { outcome: "idle" };

  let head: Uint8Array<ArrayBufferLike>;
  let tail: Uint8Array<ArrayBufferLike> = new Uint8Array();
  try {
    const headBytes = Math.min(job.expectedSize, INSPECTION_WINDOW_BYTES);
    head = await input.storage.readObjectRange(job.storageKey, 0, headBytes);
    if (job.expectedSize > INSPECTION_WINDOW_BYTES) {
      tail = await input.storage.readObjectRange(
        job.storageKey,
        job.expectedSize - INSPECTION_WINDOW_BYTES,
        INSPECTION_WINDOW_BYTES,
      );
    }
  } catch (error) {
    await finishReadFailure(input.repository, job);
    throw error;
  }
  const inspection = inspectMp4(head, tail, job.expectedSize);
  if (!inspection.valid) {
    try {
      await input.storage.deleteObject(job.storageKey);
    } catch (error) {
      await finishReadFailure(input.repository, job);
      throw error;
    }
    const failureCode = inspection.failureCode;
    await requireLease(input.repository.fail(job, failureCode));
    return { outcome: "failed", sourceId: job.sourceId, failureCode };
  }

  await requireLease(input.repository.complete(job, {
    mediaType: "video/mp4",
    durationMs: inspection.durationMs,
    videoCodec: inspection.videoCodec,
    audioCodec: inspection.audioCodec,
  }));
  return {
    outcome: "passed",
    sourceId: job.sourceId,
    detectedMediaType: "video/mp4",
    durationMs: inspection.durationMs,
    videoCodec: inspection.videoCodec,
    audioCodec: inspection.audioCodec,
  };
}

async function finishReadFailure(repository: ScanRepository, job: ScanJob) {
  const updated = job.attempt >= MAX_ATTEMPTS
    ? await repository.fail(job, "scan_storage_error")
    : await repository.release(job, "scan_storage_error");
  await requireLease(updated);
}

async function requireLease(result: Promise<boolean> | boolean) {
  if (!await result) throw new Error("The scan lease is no longer active.");
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  let value = "";
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]!);
  return value;
}

function readBox(bytes: Uint8Array, start: number, limit = bytes.byteLength): BoxView | null {
  if (start < 0 || limit > bytes.byteLength || start + 8 > limit) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(start, false);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (start + 16 > limit) return null;
    const extended = view.getBigUint64(start + 8, false);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extended);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - start;
  }
  if (size < headerSize || start + size > limit) return null;
  return {
    type: ascii(bytes, start + 4, start + 8),
    start,
    payloadStart: start + headerSize,
    end: start + size,
  };
}

function readChildBoxes(bytes: Uint8Array, start: number, end: number): BoxView[] | null {
  const boxes: BoxView[] = [];
  let offset = start;
  while (offset < end) {
    const box = readBox(bytes, offset, end);
    if (!box) return null;
    boxes.push(box);
    offset = box.end;
  }
  return offset === end ? boxes : null;
}

function findTopLevelMovieBox(head: Uint8Array, tail: Uint8Array, totalSize: number) {
  const tailStart = totalSize - tail.byteLength;
  let offset = 0;
  for (let boxes = 0; boxes < 10_000 && offset < totalSize; boxes += 1) {
    const source = offset + 8 <= head.byteLength
      ? { bytes: head, localOffset: offset }
      : offset >= tailStart && offset - tailStart + 8 <= tail.byteLength
        ? { bytes: tail, localOffset: offset - tailStart }
        : null;
    if (!source) return null;
    const declared = readDeclaredBox(source.bytes, source.localOffset, offset, totalSize);
    if (!declared) return null;
    if (declared.type === "moov") {
      const box = readBox(source.bytes, source.localOffset);
      if (!box || box.end - box.start !== declared.end - offset) return null;
      return { bytes: source.bytes, box };
    }
    if (declared.end <= offset) return null;
    offset = declared.end;
  }
  return null;
}

function readDeclaredBox(
  bytes: Uint8Array,
  localStart: number,
  absoluteStart: number,
  totalSize: number,
) {
  if (localStart < 0 || localStart + 8 > bytes.byteLength) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(localStart, false);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (localStart + 16 > bytes.byteLength) return null;
    const extended = view.getBigUint64(localStart + 8, false);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extended);
    headerSize = 16;
  } else if (size32 === 0) {
    size = totalSize - absoluteStart;
  }
  const end = absoluteStart + size;
  if (size < headerSize || end > totalSize) return null;
  return { type: ascii(bytes, localStart + 4, localStart + 8), end };
}

function readMovieDuration(bytes: Uint8Array, box: BoxView): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[box.payloadStart];
  if (version === 0) {
    if (box.payloadStart + 20 > box.end) return null;
    const timescale = view.getUint32(box.payloadStart + 12, false);
    const duration = view.getUint32(box.payloadStart + 16, false);
    if (timescale === 0) return null;
    return Math.round((duration / timescale) * 1_000);
  }
  if (version === 1) {
    if (box.payloadStart + 32 > box.end) return null;
    const timescale = view.getUint32(box.payloadStart + 20, false);
    const duration = view.getBigUint64(box.payloadStart + 24, false);
    if (timescale === 0 || duration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Math.round((Number(duration) / timescale) * 1_000);
  }
  return null;
}

function readTrackMetadata(bytes: Uint8Array, track: BoxView): TrackMetadata | null {
  const trackChildren = readChildBoxes(bytes, track.payloadStart, track.end);
  const media = trackChildren?.find((box) => box.type === "mdia");
  if (!media) return null;
  const mediaChildren = readChildBoxes(bytes, media.payloadStart, media.end);
  if (!mediaChildren) return null;
  const handler = mediaChildren.find((box) => box.type === "hdlr");
  if (!handler || handler.payloadStart + 12 > handler.end) return null;
  const handlerType = ascii(bytes, handler.payloadStart + 8, handler.payloadStart + 12);
  const mediaInformation = mediaChildren.find((box) => box.type === "minf");
  if (!mediaInformation) return { handlerType };
  const mediaInformationChildren = readChildBoxes(bytes, mediaInformation.payloadStart, mediaInformation.end);
  const sampleTable = mediaInformationChildren?.find((box) => box.type === "stbl");
  if (!sampleTable) return { handlerType };
  const sampleTableChildren = readChildBoxes(bytes, sampleTable.payloadStart, sampleTable.end);
  const sampleDescription = sampleTableChildren?.find((box) => box.type === "stsd");
  if (!sampleDescription || sampleDescription.payloadStart + 8 > sampleDescription.end) return { handlerType };
  const sampleEntry = readBox(bytes, sampleDescription.payloadStart + 8, sampleDescription.end);
  return { handlerType, ...(sampleEntry ? { codec: sampleEntry.type } : {}) };
}
