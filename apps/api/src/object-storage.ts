import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

export interface UploadPolicy {
  url: string;
  fields: Record<string, string>;
  expiresAt: string;
}

export interface StoredObjectMetadata {
  size: number;
  contentType: string;
}

export interface ObjectStorage {
  readonly isAvailable: boolean;
  createUpload(input: {
    key: string;
    contentType: string;
    exactSize: number;
    expiresInSeconds: number;
  }): Promise<UploadPolicy>;
  inspectObject(key: string): Promise<StoredObjectMetadata>;
  readObjectPrefix(key: string, maximumBytes: number): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
}

export class ObjectStorageUnavailableError extends Error {}
export class StoredObjectNotFoundError extends Error {}

export interface ObjectStorageConfiguration {
  enabled: boolean;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  requireSseHeader?: boolean;
}

export function loadObjectStorageConfiguration(environment: NodeJS.ProcessEnv): ObjectStorageConfiguration {
  const bucket = environment.OBJECT_STORAGE_BUCKET?.trim();
  const related = [
    environment.OBJECT_STORAGE_REGION,
    environment.OBJECT_STORAGE_ENDPOINT,
    environment.OBJECT_STORAGE_ACCESS_KEY_ID,
    environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
  ].some((value) => Boolean(value?.trim()));
  if (!bucket && !related) return { enabled: false };
  if (!bucket) throw new Error("OBJECT_STORAGE_BUCKET is required when object storage is configured.");
  const region = environment.OBJECT_STORAGE_REGION?.trim();
  if (!region) throw new Error("OBJECT_STORAGE_REGION is required when object storage is configured.");
  const accessKeyId = environment.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("Object storage access key ID and secret must be configured together.");
  }
  const endpoint = environment.OBJECT_STORAGE_ENDPOINT?.trim();
  if (endpoint) {
    const parsed = new URL(endpoint);
    const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    if (parsed.origin !== endpoint || (parsed.protocol !== "https:" && !localHttp)) {
      throw new Error("OBJECT_STORAGE_ENDPOINT must be one HTTPS origin (localhost HTTP is allowed).");
    }
  }
  return {
    enabled: true,
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    requireSseHeader: environment.OBJECT_STORAGE_REQUIRE_SSE_HEADER !== "false",
  };
}

export function createObjectStorage(configuration: ObjectStorageConfiguration): ObjectStorage {
  if (!configuration.enabled) return new DisabledObjectStorage();
  const clientConfiguration: S3ClientConfig = {
    region: configuration.region!,
    ...(configuration.endpoint ? { endpoint: configuration.endpoint } : {}),
    ...(configuration.forcePathStyle ? { forcePathStyle: true } : {}),
    ...(configuration.accessKeyId && configuration.secretAccessKey ? {
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    } : {}),
  };
  return new S3ObjectStorage(
    new S3Client(clientConfiguration),
    configuration.bucket!,
    configuration.requireSseHeader ?? true,
  );
}

export class S3ObjectStorage implements ObjectStorage {
  readonly isAvailable = true;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly requireSseHeader = true,
  ) {}

  async createUpload(input: {
    key: string;
    contentType: string;
    exactSize: number;
    expiresInSeconds: number;
  }): Promise<UploadPolicy> {
    const fields: Record<string, string> = { "Content-Type": input.contentType };
    const conditions: Array<["eq", string, string] | ["content-length-range", number, number]> = [
      ["content-length-range", input.exactSize, input.exactSize],
      ["eq", "$Content-Type", input.contentType],
    ];
    if (this.requireSseHeader) {
      fields["x-amz-server-side-encryption"] = "AES256";
      conditions.push(["eq", "$x-amz-server-side-encryption", "AES256"]);
    }
    const result = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: input.key,
      Expires: input.expiresInSeconds,
      Fields: fields,
      Conditions: conditions,
    });
    return {
      url: result.url,
      fields: result.fields,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString(),
    };
  }

  async inspectObject(key: string): Promise<StoredObjectMetadata> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (typeof result.ContentLength !== "number" || typeof result.ContentType !== "string") {
        throw new StoredObjectNotFoundError("The uploaded object has incomplete metadata.");
      }
      return { size: result.ContentLength, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof StoredObjectNotFoundError) throw error;
      const name = error instanceof Error ? error.name : "";
      if (name === "NotFound" || name === "NoSuchKey") {
        throw new StoredObjectNotFoundError("The uploaded object was not found.");
      }
      throw error;
    }
  }

  async readObjectPrefix(key: string, maximumBytes: number) {
    if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 64 * 1024) {
      throw new Error("Object prefix reads must be between 1 byte and 64 KB.");
    }
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${maximumBytes - 1}`,
      }));
      if (!result.Body || !(Symbol.asyncIterator in result.Body)) {
        throw new StoredObjectNotFoundError("The uploaded object body was unavailable.");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of result.Body) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        total += bytes.byteLength;
        if (total > maximumBytes) throw new Error("Object storage ignored the bounded range request.");
        chunks.push(bytes);
      }
      const prefix = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        prefix.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return prefix;
    } catch (error) {
      if (error instanceof StoredObjectNotFoundError) throw error;
      const name = error instanceof Error ? error.name : "";
      if (name === "NotFound" || name === "NoSuchKey") {
        throw new StoredObjectNotFoundError("The uploaded object was not found.");
      }
      throw error;
    }
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

class DisabledObjectStorage implements ObjectStorage {
  readonly isAvailable = false;
  async createUpload(): Promise<UploadPolicy> {
    throw new ObjectStorageUnavailableError("Private object storage is not configured.");
  }
  async inspectObject(): Promise<StoredObjectMetadata> {
    throw new ObjectStorageUnavailableError("Private object storage is not configured.");
  }
  async readObjectPrefix(): Promise<Uint8Array> {
    throw new ObjectStorageUnavailableError("Private object storage is not configured.");
  }
  async deleteObject() {
    throw new ObjectStorageUnavailableError("Private object storage is not configured.");
  }
}
