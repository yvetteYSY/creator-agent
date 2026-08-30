import { randomUUID } from "node:crypto";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { createObjectStorage, loadObjectStorageConfiguration } from "../src/object-storage";
import { validateMp4Prefix } from "../src/scanner";

const endpoint = process.env.TEST_OBJECT_STORAGE_ENDPOINT;
const suite = describe.skipIf(!endpoint);

suite("S3-compatible object storage integration", () => {
  it("uploads with the signed policy, verifies metadata, and deletes the object", async () => {
    const environment = {
      OBJECT_STORAGE_BUCKET: process.env.TEST_OBJECT_STORAGE_BUCKET ?? "creator-agent-private",
      OBJECT_STORAGE_REGION: process.env.TEST_OBJECT_STORAGE_REGION ?? "us-east-1",
      OBJECT_STORAGE_ENDPOINT: endpoint,
      OBJECT_STORAGE_ACCESS_KEY_ID: process.env.TEST_OBJECT_STORAGE_ACCESS_KEY_ID ?? "creator-agent-local",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: process.env.TEST_OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "creator-agent-local-secret",
      OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
      OBJECT_STORAGE_REQUIRE_SSE_HEADER: "false",
    };
    const client = new S3Client({
      region: environment.OBJECT_STORAGE_REGION,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
    });
    try {
      try {
        await client.send(new CreateBucketCommand({ Bucket: environment.OBJECT_STORAGE_BUCKET }));
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
      }

      const storage = createObjectStorage(loadObjectStorageConfiguration(environment));
      const bytes = new Uint8Array([
        0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109,
        0, 0, 2, 0, 109, 112, 52, 50,
      ]);
      const key = `private-uploads/integration-${randomUUID()}`;
      const policy = await storage.createUpload({
        key,
        contentType: "video/mp4",
        exactSize: bytes.byteLength,
        expiresInSeconds: 60,
      });
      const form = new FormData();
      for (const [field, value] of Object.entries(policy.fields)) form.append(field, value);
      form.append("file", new Blob([bytes], { type: "video/mp4" }), "integration.mp4");

      const uploaded = await fetch(policy.url, { method: "POST", body: form });
      expect(uploaded.status).toBe(204);
      await expect(storage.inspectObject(key)).resolves.toEqual({
        size: bytes.byteLength,
        contentType: "video/mp4",
      });
      const prefix = await storage.readObjectPrefix(key, 64);
      expect(prefix).toEqual(bytes);
      const middle = await storage.readObjectRange(key, 8, 4);
      expect(middle).toEqual(bytes.slice(8, 12));
      expect(validateMp4Prefix(prefix)).toEqual({ valid: true });
      await storage.deleteObject(key);
      await expect(storage.inspectObject(key)).rejects.toThrowError(/not found/i);

      const rejectedKey = `private-uploads/integration-rejected-${randomUUID()}`;
      const rejectedPolicy = await storage.createUpload({
        key: rejectedKey,
        contentType: "video/mp4",
        exactSize: bytes.byteLength + 1,
        expiresInSeconds: 60,
      });
      const rejectedForm = new FormData();
      for (const [field, value] of Object.entries(rejectedPolicy.fields)) rejectedForm.append(field, value);
      rejectedForm.append("file", new Blob([bytes], { type: "video/mp4" }), "too-small.mp4");
      const rejected = await fetch(rejectedPolicy.url, { method: "POST", body: rejectedForm });
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      await expect(storage.inspectObject(rejectedKey)).rejects.toThrowError(/not found/i);
    } finally {
      client.destroy();
    }
  });
});
