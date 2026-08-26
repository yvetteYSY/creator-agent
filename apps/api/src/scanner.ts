import type { ObjectStorage } from "./object-storage";
import type { ScanJob, ScanRepository } from "./scanner-store";

const PREFIX_BYTES = 4096;
const MAX_ATTEMPTS = 3;
const STALE_LEASE_MILLISECONDS = 15 * 60 * 1000;
const MP4_BRANDS = new Set([
  "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom",
  "M4V ", "mp41", "mp42", "MSNV",
]);

export type ScanRunResult =
  | { outcome: "idle" }
  | { outcome: "passed"; sourceId: string; detectedMediaType: "video/mp4" }
  | { outcome: "failed"; sourceId: string; failureCode: string };

export interface Mp4SignatureResult {
  valid: boolean;
  failureCode?: "media_too_small" | "invalid_mp4_box" | "unsupported_mp4_brand";
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

  let prefix: Uint8Array;
  try {
    prefix = await input.storage.readObjectPrefix(job.storageKey, PREFIX_BYTES);
  } catch (error) {
    await finishReadFailure(input.repository, job);
    throw error;
  }
  const signature = validateMp4Prefix(prefix);
  if (!signature.valid) {
    try {
      await input.storage.deleteObject(job.storageKey);
    } catch (error) {
      await finishReadFailure(input.repository, job);
      throw error;
    }
    const failureCode = signature.failureCode ?? "invalid_media_signature";
    await requireLease(input.repository.fail(job, failureCode));
    return { outcome: "failed", sourceId: job.sourceId, failureCode };
  }

  await requireLease(input.repository.complete(job, "video/mp4"));
  return { outcome: "passed", sourceId: job.sourceId, detectedMediaType: "video/mp4" };
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
