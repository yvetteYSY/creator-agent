import { describe, expect, it } from "vitest";
import type { ObjectStorage, StoredObjectMetadata, UploadPolicy } from "../src/object-storage";
import { runScanOnce, validateMp4Prefix } from "../src/scanner";
import type { ScanJob, ScanRepository } from "../src/scanner-store";

const JOB: ScanJob = {
  sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  storageKey: "private-uploads/opaque",
  expectedContentType: "video/mp4",
  expectedSize: 20,
  leaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  attempt: 1,
};

class MemoryScanRepository implements ScanRepository {
  job: ScanJob | null = JOB;
  completed?: string;
  failed?: string;
  released?: string;

  async claimNext() {
    const job = this.job;
    this.job = null;
    return job;
  }

  async complete(_job: ScanJob, detectedMediaType: string) {
    this.completed = detectedMediaType;
    return true;
  }

  async fail(_job: ScanJob, failureCode: string) {
    this.failed = failureCode;
    return true;
  }

  async release(_job: ScanJob, failureCode: string) {
    this.released = failureCode;
    return true;
  }
}

class MemoryScanStorage implements ObjectStorage {
  readonly isAvailable = true;
  prefix = mp4Prefix();
  readLimit?: number;
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
    return this.prefix;
  }

  async deleteObject(key: string) {
    this.deleted.push(key);
  }
}

describe("quarantine MP4 scanner", () => {
  it("accepts a bounded ISO BMFF MP4 signature and advances only to processing", async () => {
    const repository = new MemoryScanRepository();
    const storage = new MemoryScanStorage();
    await expect(runScanOnce({ repository, storage })).resolves.toEqual({
      outcome: "passed",
      sourceId: JOB.sourceId,
      detectedMediaType: "video/mp4",
    });
    expect(storage.readLimit).toBe(4096);
    expect(storage.deleted).toEqual([]);
    expect(repository.completed).toBe("video/mp4");
    expect(repository.failed).toBeUndefined();
  });

  it("deletes and disables a file whose prefix is not MP4", async () => {
    const repository = new MemoryScanRepository();
    const storage = new MemoryScanStorage();
    storage.prefix = new Uint8Array(24);
    await expect(runScanOnce({ repository, storage })).resolves.toMatchObject({
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
    await expect(runScanOnce({ repository: retryRepository, storage: retryStorage }))
      .rejects.toThrowError(/temporary storage failure/i);
    expect(retryRepository.released).toBe("scan_storage_error");
    expect(retryRepository.failed).toBeUndefined();

    const finalRepository = new MemoryScanRepository();
    finalRepository.job = { ...JOB, attempt: 3 };
    const finalStorage = new MemoryScanStorage();
    finalStorage.readError = new Error("persistent storage failure");
    await expect(runScanOnce({ repository: finalRepository, storage: finalStorage }))
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

  it("does nothing when no uploaded source is available", async () => {
    const repository = new MemoryScanRepository();
    repository.job = null;
    await expect(runScanOnce({ repository, storage: new MemoryScanStorage() }))
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
