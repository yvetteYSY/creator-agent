import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const sql = await readFile(new URL("../migrations/001_creator_identities.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("Applied migration 001_creator_identities.sql");
} finally {
  await pool.end();
}
