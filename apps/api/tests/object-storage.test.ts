import { describe, expect, it, vi } from "vitest";
import {
  ObjectStorageUnavailableError,
  S3ObjectStorage,
  createObjectStorage,
  loadObjectStorageConfiguration,
} from "../src/object-storage";

describe("private object storage", () => {
  it("stays disabled without configuration and rejects partial secrets", async () => {
    const disabled = createObjectStorage(loadObjectStorageConfiguration({}));
    expect(disabled.isAvailable).toBe(false);
    await expect(disabled.createUpload({
      key: "unused",
      contentType: "video/mp4",
      exactSize: 1,
      expiresInSeconds: 60,
    })).rejects.toThrowError(ObjectStorageUnavailableError);
    expect(() => loadObjectStorageConfiguration({ OBJECT_STORAGE_REGION: "us-east-1" }))
      .toThrowError(/bucket/i);
    expect(() => loadObjectStorageConfiguration({
      OBJECT_STORAGE_BUCKET: "private",
      OBJECT_STORAGE_REGION: "us-east-1",
      OBJECT_STORAGE_ACCESS_KEY_ID: "only-one-half",
    })).toThrowError(/configured together/i);
    expect(() => loadObjectStorageConfiguration({
      OBJECT_STORAGE_BUCKET: "private",
      OBJECT_STORAGE_REGION: "us-east-1",
      OBJECT_STORAGE_ENDPOINT: "http://storage.example",
    })).toThrowError(/HTTPS origin/i);
  });

  it("creates a short-lived POST policy that pins key, content type, size, and encryption", async () => {
    const storage = createObjectStorage(loadObjectStorageConfiguration({
      OBJECT_STORAGE_BUCKET: "creator-agent-private",
      OBJECT_STORAGE_REGION: "us-east-1",
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_ACCESS_KEY_ID: "local-access-key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "local-secret-key",
      OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
    }));
    const policy = await storage.createUpload({
      key: "private-uploads/opaque-id",
      contentType: "video/mp4",
      exactSize: 1234,
      expiresInSeconds: 600,
    });
    expect(policy.url).toBe("http://127.0.0.1:9000/creator-agent-private");
    expect(policy.fields).toMatchObject({
      key: "private-uploads/opaque-id",
      "Content-Type": "video/mp4",
      "x-amz-server-side-encryption": "AES256",
    });
    const decoded = JSON.parse(Buffer.from(policy.fields.Policy, "base64").toString("utf8"));
    expect(decoded.conditions).toContainEqual(["content-length-range", 1234, 1234]);
    expect(decoded.conditions).toContainEqual(["eq", "$Content-Type", "video/mp4"]);
    expect(decoded.conditions).toContainEqual(["eq", "$x-amz-server-side-encryption", "AES256"]);
  });

  it("uses an exact bounded byte range and rejects unsafe range requests", async () => {
    const send = vi.fn(async () => ({
      Body: {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([10, 11]);
          yield new Uint8Array([12, 13]);
        },
      },
    }));
    const storage = new S3ObjectStorage({ send } as never, "private", false);
    await expect(storage.readObjectRange("private-uploads/opaque", 100, 4))
      .resolves.toEqual(new Uint8Array([10, 11, 12, 13]));
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        Bucket: "private",
        Key: "private-uploads/opaque",
        Range: "bytes=100-103",
      },
    }));
    await expect(storage.readObjectRange("unused", -1, 4)).rejects.toThrowError(/offset/i);
    await expect(storage.readObjectRange("unused", 0, 1024 * 1024 + 1)).rejects.toThrowError(/1 MB/i);
  });
});
