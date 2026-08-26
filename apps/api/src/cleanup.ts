import type { ObjectStorage } from "./object-storage";
import type { StorageDeletionRepository } from "./cleanup-store";

const MAX_ATTEMPTS = 100;
const STALE_LEASE_MILLISECONDS = 15 * 60 * 1000;

export type CleanupRunResult =
  | { outcome: "idle" }
  | { outcome: "deleted"; sourceId: string };

export async function runCleanupOnce(input: {
  repository: StorageDeletionRepository;
  storage: ObjectStorage;
  now?: Date;
}): Promise<CleanupRunResult> {
  const now = input.now ?? new Date();
  const job = await input.repository.claimNext({
    staleBefore: new Date(now.getTime() - STALE_LEASE_MILLISECONDS),
    maxAttempts: MAX_ATTEMPTS,
  });
  if (!job) return { outcome: "idle" };
  try {
    await input.storage.deleteObject(job.storageKey);
  } catch (error) {
    if (!await input.repository.release(job, "storage_delete_error")) {
      throw new Error("The storage-deletion lease is no longer active.");
    }
    throw error;
  }
  if (!await input.repository.complete(job)) {
    throw new Error("The storage-deletion lease is no longer active.");
  }
  return { outcome: "deleted", sourceId: job.sourceId };
}
