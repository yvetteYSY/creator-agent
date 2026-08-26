import { describe, expect, it } from "vitest";
import type { StorageDeletionJob, StorageDeletionRepository } from "../src/cleanup-store";
import { runCleanupOnce } from "../src/cleanup";
import type { ObjectStorage, StoredObjectMetadata, UploadPolicy } from "../src/object-storage";

const JOB: StorageDeletionJob = {
  sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  storageKey: "private-uploads/opaque",
  leaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  attempt: 1,
};

class MemoryDeletionRepository implements StorageDeletionRepository {
  job: StorageDeletionJob | null = JOB;
  completed = false;
  released?: string;

  async claimNext() {
    const job = this.job;
    this.job = null;
    return job;
  }

  async complete() {
    this.completed = true;
    return true;
  }

  async release(_job: StorageDeletionJob, failureCode: string) {
    this.released = failureCode;
    return true;
  }
}

class MemoryDeletionStorage implements ObjectStorage {
  readonly isAvailable = true;
  deleted: string[] = [];
  error?: Error;

  async createUpload(): Promise<UploadPolicy> {
    throw new Error("unused");
  }

  async inspectObject(): Promise<StoredObjectMetadata> {
    throw new Error("unused");
  }

  async readObjectPrefix(): Promise<Uint8Array> {
    throw new Error("unused");
  }

  async deleteObject(key: string) {
    if (this.error) throw this.error;
    this.deleted.push(key);
  }
}

describe("storage deletion reconciler", () => {
  it("physically deletes one tombstoned source and completes its lease", async () => {
    const repository = new MemoryDeletionRepository();
    const storage = new MemoryDeletionStorage();
    await expect(runCleanupOnce({ repository, storage })).resolves.toEqual({
      outcome: "deleted",
      sourceId: JOB.sourceId,
    });
    expect(storage.deleted).toEqual([JOB.storageKey]);
    expect(repository.completed).toBe(true);
    expect(repository.released).toBeUndefined();
  });

  it("releases the lease after a retryable storage failure", async () => {
    const repository = new MemoryDeletionRepository();
    const storage = new MemoryDeletionStorage();
    storage.error = new Error("temporary delete failure");
    await expect(runCleanupOnce({ repository, storage })).rejects.toThrowError(/temporary delete failure/i);
    expect(repository.completed).toBe(false);
    expect(repository.released).toBe("storage_delete_error");
  });

  it("does nothing when no tombstoned stored source is pending", async () => {
    const repository = new MemoryDeletionRepository();
    repository.job = null;
    await expect(runCleanupOnce({ repository, storage: new MemoryDeletionStorage() }))
      .resolves.toEqual({ outcome: "idle" });
  });
});
