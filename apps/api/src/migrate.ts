import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const migrations = ["001_creator_identities.sql", "002_creator_workspace.sql"];
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const migration of migrations) {
    const applied = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1) AS exists",
      [migration],
    );
    if (applied.rows[0]?.exists) {
      console.log(`Skipped migration ${migration} (already applied)`);
      continue;
    }
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration]);
    console.log(`Applied migration ${migration}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
