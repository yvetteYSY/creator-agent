import { describe, expect, it } from "vitest";
import type { MalwareScanner, MalwareScanVerdict } from "../src/malware-scanner";
import type { ObjectStorage, StoredObjectMetadata, UploadPolicy } from "../src/object-storage";
import { inspectMp4, runScanOnce, validateMp4Prefix } from "../src/scanner";
import type {
  DetectedMediaMetadata,
  CleanMalwareScanMetadata,
  InfectedMalwareScanMetadata,
  MalwareScanMetadata,
  ScanJob,
  ScanRepository,
} from "../src/scanner-store";

const VALID_MP4 = mp4File();

const JOB: ScanJob = {
  sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  storageKey: "private-uploads/opaque",
  expectedContentType: "video/mp4",
  expectedSize: VALID_MP4.byteLength,
  leaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  attempt: 1,
};

class MemoryScanRepository implements ScanRepository {
  job: ScanJob | null = JOB;
  completed?: DetectedMediaMetadata;
  completedMalware?: MalwareScanMetadata;
  failed?: string;
  failedMalware?: MalwareScanMetadata;
  released?: string;

  async claimNext() {
    const job = this.job;
    this.job = null;
    return job;
  }

  async complete(_job: ScanJob, media: DetectedMediaMetadata, malware: CleanMalwareScanMetadata) {
    this.completed = media;
    this.completedMalware = malware;
    return true;
  }

  async fail(_job: ScanJob, failureCode: string, malware?: InfectedMalwareScanMetadata) {
    this.failed = failureCode;
    this.failedMalware = malware;
    return true;
  }

  async release(_job: ScanJob, failureCode: string) {
    this.released = failureCode;
    return true;
  }
}

class MemoryMalwareScanner implements MalwareScanner {
  readonly isAvailable = true;
  verdict: MalwareScanVerdict = { status: "clean", scanner: "clamav" };
  error?: Error;
  scannedBytes = 0;

  async scan(input: { chunks: AsyncIterable<Uint8Array>; expectedSize: number }) {
    if (this.error) throw this.error;
    for await (const chunk of input.chunks) this.scannedBytes += chunk.byteLength;
    expect(this.scannedBytes).toBe(input.expectedSize);
    return this.verdict;
  }
}

class MemoryScanStorage implements ObjectStorage {
  readonly isAvailable = true;
  bytes = VALID_MP4;
  readLimit?: number;
  ranges: Array<{ offset: number; maximumBytes: number }> = [];
  deleted: string[] = [];
  readError?: Error;

  async createUpload(): Promise<UploadPolicy> {
    throw new Error("unused");
  }

  async inspectObject(): Promise<StoredObjectMetadata> {
    throw new Error("unused");
  }

  async readObjectPrefix(_key: string, maximumBytes: number) {
    this.readLimit = maximumBytes;
    if (this.readError) throw this.readError;
    return this.bytes.slice(0, maximumBytes);
  }

  async readObjectRange(_key: string, offset: number, maximumBytes: number) {
    this.ranges.push({ offset, maximumBytes });
    if (this.readError) throw this.readError;
    return this.bytes.slice(offset, offset + maximumBytes);
  }

  async deleteObject(key: string) {
    this.deleted.push(key);
  }
}

describe("quarantine MP4 scanner", () => {
  it("accepts bounded MP4 metadata with H.264 video and AAC audio", async () => {
    const repository = new MemoryScanRepository();
    const storage = new MemoryScanStorage();
    const malwareScanner = new MemoryMalwareScanner();
    await expect(runScanOnce({ repository, storage, malwareScanner })).resolves.toEqual({
      outcome: "passed",
      sourceId: JOB.sourceId,
      detectedMediaType: "video/mp4",
      durationMs: 182_200,
      videoCodec: "avc1",
      audioCodec: "mp4a",
      malwareStatus: "clean",
    });
    expect(storage.ranges).toEqual([
      { offset: 0, maximumBytes: VALID_MP4.byteLength },
      { offset: 0, maximumBytes: VALID_MP4.byteLength },
    ]);
    expect(malwareScanner.scannedBytes).toBe(VALID_MP4.byteLength);
    expect(storage.deleted).toEqual([]);
    expect(repository.completed).toEqual({
      mediaType: "video/mp4",
      durationMs: 182_200,
      videoCodec: "avc1",
      audioCodec: "mp4a",
    });
    expect(repository.completedMalware).toEqual({ status: "clean", scanner: "clamav" });
    expect(repository.failed).toBeUndefined();
  });

  it("deletes and disables a file whose prefix is not MP4", async () => {
    const repository = new MemoryScanRepository();
    const storage = new MemoryScanStorage();
    storage.bytes = new Uint8Array(24);
    repository.job = { ...JOB, expectedSize: storage.bytes.byteLength };
    await expect(runScanOnce({ repository, storage, malwareScanner: new MemoryMalwareScanner() })).resolves.toMatchObject({
      outcome: "failed",
      failureCode: "invalid_mp4_box",
    });
    expect(storage.deleted).toEqual([JOB.storageKey]);
    expect(repository.failed).toBe("invalid_mp4_box");
    expect(repository.completed).toBeUndefined();
  });

  it("releases transient storage failures and disables after the final attempt", async () => {
    const retryRepository = new MemoryScanRepository();
    const retryStorage = new MemoryScanStorage();
    retryStorage.readError = new Error("temporary storage failure");
    await expect(runScanOnce({
      repository: retryRepository,
      storage: retryStorage,
      malwareScanner: new MemoryMalwareScanner(),
    }))
      .rejects.toThrowError(/temporary storage failure/i);
    expect(retryRepository.released).toBe("scan_storage_error");
    expect(retryRepository.failed).toBeUndefined();

    const finalRepository = new MemoryScanRepository();
    finalRepository.job = { ...JOB, attempt: 3 };
    const finalStorage = new MemoryScanStorage();
    finalStorage.readError = new Error("persistent storage failure");
    await expect(runScanOnce({
      repository: finalRepository,
      storage: finalStorage,
      malwareScanner: new MemoryMalwareScanner(),
    }))
      .rejects.toThrowError(/persistent storage failure/i);
    expect(finalRepository.failed).toBe("scan_storage_error");
    expect(finalRepository.released).toBeUndefined();
  });

  it("recognizes supported compatible brands and rejects incomplete or unsupported boxes", () => {
    expect(validateMp4Prefix(mp4Prefix())).toEqual({ valid: true });
    expect(validateMp4Prefix(new Uint8Array(8))).toEqual({
      valid: false,
      failureCode: "media_too_small",
    });
    expect(validateMp4Prefix(mp4Prefix("zzzz", "yyyy"))).toEqual({
      valid: false,
      failureCode: "unsupported_mp4_brand",
    });
    expect(validateMp4Prefix(mp4Prefix("zzzz", "isom"))).toEqual({ valid: true });
  });

  it("reads a bounded tail window when the moov box follows a large media payload", async () => {
    const bytes = mp4File({ mediaPayloadBytes: 600_000 });
    const repository = new MemoryScanRepository();
    repository.job = { ...JOB, expectedSize: bytes.byteLength };
    const storage = new MemoryScanStorage();
    storage.bytes = bytes;

    await expect(runScanOnce({
      repository,
      storage,
      malwareScanner: new MemoryMalwareScanner(),
    })).resolves.toMatchObject({
      outcome: "passed",
      durationMs: 182_200,
    });
    expect(storage.ranges).toHaveLength(3);
    expect(storage.ranges[0]).toEqual({ offset: 0, maximumBytes: 524_288 });
    expect(storage.ranges[1]?.offset).toBe(bytes.byteLength - 524_288);
    expect(storage.ranges[2]).toEqual({ offset: 0, maximumBytes: bytes.byteLength });
  });

  it("deletes infected objects and keeps scanner outages in quarantine", async () => {
    const infectedRepository = new MemoryScanRepository();
    const infectedStorage = new MemoryScanStorage();
    const infectedScanner = new MemoryMalwareScanner();
    infectedScanner.verdict = { status: "infected", scanner: "clamav" };
    await expect(runScanOnce({
      repository: infectedRepository,
      storage: infectedStorage,
      malwareScanner: infectedScanner,
    })).resolves.toMatchObject({ outcome: "failed", failureCode: "malware_detected" });
    expect(infectedStorage.deleted).toEqual([JOB.storageKey]);
    expect(infectedRepository.failedMalware).toEqual({ status: "infected", scanner: "clamav" });

    const unavailableRepository = new MemoryScanRepository();
    const unavailableScanner = new MemoryMalwareScanner();
    unavailableScanner.error = new Error("scanner unavailable");
    await expect(runScanOnce({
      repository: unavailableRepository,
      storage: new MemoryScanStorage(),
      malwareScanner: unavailableScanner,
    })).rejects.toThrowError(/scanner unavailable/i);
    expect(unavailableRepository.released).toBe("malware_scanner_error");
    expect(unavailableRepository.completed).toBeUndefined();
  });

  it("releases a job when the object becomes truncated during full malware streaming", async () => {
    const repository = new MemoryScanRepository();
    repository.job = { ...JOB, expectedSize: VALID_MP4.byteLength + 1 };
    const storage = new MemoryScanStorage();
    await expect(runScanOnce({
      repository,
      storage,
      malwareScanner: new MemoryMalwareScanner(),
    })).rejects.toThrowError(/changed size/i);
    expect(repository.released).toBe("scan_storage_error");
    expect(repository.completed).toBeUndefined();
  });

  it("rejects missing audio, unsupported codecs, and unreasonable duration", () => {
    expect(inspectMp4(mp4File({ includeAudio: false }), new Uint8Array(), 0)).toMatchObject({
      valid: false,
      failureCode: "missing_audio_track",
    });
    expect(inspectMp4(mp4File({ videoCodec: "vp09" }), new Uint8Array(), 0)).toMatchObject({
      valid: false,
      failureCode: "unsupported_video_codec",
    });
    expect(inspectMp4(mp4File({ audioCodec: "Opus" }), new Uint8Array(), 0)).toMatchObject({
      valid: false,
      failureCode: "unsupported_audio_codec",
    });
    expect(inspectMp4(mp4File({ durationMs: 14_400_001 }), new Uint8Array(), 0)).toMatchObject({
      valid: false,
      failureCode: "media_duration_out_of_range",
    });
  });

  it("rejects files without complete movie metadata", () => {
    const bytes = concatBytes(mp4Prefix(), box("mdat", new Uint8Array(32)));
    expect(inspectMp4(bytes, new Uint8Array(), bytes.byteLength)).toEqual({
      valid: false,
      failureCode: "mp4_metadata_not_found",
    });
  });

  it("does not mistake movie-like bytes inside media payloads for a top-level moov box", () => {
    const valid = mp4File();
    const embeddedMoov = findBoxBytes(valid, "moov");
    const bytes = concatBytes(mp4Prefix(), box("mdat", embeddedMoov));
    expect(inspectMp4(bytes, new Uint8Array(), bytes.byteLength)).toEqual({
      valid: false,
      failureCode: "mp4_metadata_not_found",
    });
  });

  it("does nothing when no uploaded source is available", async () => {
    const repository = new MemoryScanRepository();
    repository.job = null;
    await expect(runScanOnce({
      repository,
      storage: new MemoryScanStorage(),
      malwareScanner: new MemoryMalwareScanner(),
    }))
      .resolves.toEqual({ outcome: "idle" });
  });
});

function mp4Prefix(majorBrand = "isom", compatibleBrand = "mp42") {
  const bytes = new Uint8Array(20);
  new DataView(bytes.buffer).setUint32(0, 20, false);
  writeAscii(bytes, 4, "ftyp");
  writeAscii(bytes, 8, majorBrand);
  new DataView(bytes.buffer).setUint32(12, 512, false);
  writeAscii(bytes, 16, compatibleBrand);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function mp4File(options: {
  durationMs?: number;
  videoCodec?: string;
  audioCodec?: string;
  includeAudio?: boolean;
  mediaPayloadBytes?: number;
} = {}) {
  const durationMs = options.durationMs ?? 182_200;
  const video = track("vide", options.videoCodec ?? "avc1");
  const audio = options.includeAudio === false ? new Uint8Array() : track("soun", options.audioCodec ?? "mp4a");
  const moov = box("moov", concatBytes(movieHeader(durationMs), video, audio));
  const media = box("mdat", new Uint8Array(options.mediaPayloadBytes ?? 16));
  return concatBytes(mp4Prefix(), media, moov);
}

function movieHeader(durationMs: number) {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  view.setUint32(12, 1_000, false);
  view.setUint32(16, durationMs, false);
  return box("mvhd", payload);
}

function track(handlerType: string, codec: string) {
  const handler = new Uint8Array(12);
  writeAscii(handler, 8, handlerType);
  const sampleEntry = box(codec, new Uint8Array());
  const sampleDescriptionHeader = new Uint8Array(8);
  new DataView(sampleDescriptionHeader.buffer).setUint32(4, 1, false);
  const stsd = box("stsd", concatBytes(sampleDescriptionHeader, sampleEntry));
  return box("trak", box("mdia", concatBytes(
    box("hdlr", handler),
    box("minf", box("stbl", stsd)),
  )));
}

function box(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(8 + payload.byteLength);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength, false);
  writeAscii(bytes, 4, type);
  bytes.set(payload, 8);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function findBoxBytes(bytes: Uint8Array, type: string) {
  for (let offset = 4; offset + 4 <= bytes.byteLength; offset += 1) {
    if (String.fromCharCode(...bytes.slice(offset, offset + 4)) !== type) continue;
    const start = offset - 4;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(start, false);
    return bytes.slice(start, start + size);
  }
  throw new Error(`Missing ${type} box in test fixture.`);
}
