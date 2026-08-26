import { Pool } from "pg";
import { PostgresStorageDeletionRepository } from "./cleanup-store";
import { runCleanupOnce } from "./cleanup";
import { createObjectStorage, loadObjectStorageConfiguration } from "./object-storage";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const storage = createObjectStorage(loadObjectStorageConfiguration(process.env));
if (!storage.isAvailable) throw new Error("Private object storage is required for cleanup.");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const result = await runCleanupOnce({
    repository: new PostgresStorageDeletionRepository(pool),
    storage,
  });
  console.log(JSON.stringify({ worker: "storage-cleanup", aiCalls: 0, ...result }));
} finally {
  await pool.end();
}
