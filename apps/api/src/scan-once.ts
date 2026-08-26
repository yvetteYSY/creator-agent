import { Pool } from "pg";
import { createObjectStorage, loadObjectStorageConfiguration } from "./object-storage";
import { runScanOnce } from "./scanner";
import { PostgresScanRepository } from "./scanner-store";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const storage = createObjectStorage(loadObjectStorageConfiguration(process.env));
if (!storage.isAvailable) throw new Error("Private object storage is required for scanning.");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const result = await runScanOnce({
    repository: new PostgresScanRepository(pool),
    storage,
  });
  console.log(JSON.stringify({ worker: "quarantine-scan", aiCalls: 0, ...result }));
} finally {
  await pool.end();
}
