import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const mode = process.argv[2];
const directory = mode === "seed" ? "db/seeds" : "db/migrations";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined });
try {
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (mode !== "seed") {
        await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        const done = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [file]);
        if (done.rowCount) { await client.query("ROLLBACK"); continue; }
      }
      await client.query(await fs.readFile(path.join(directory, file), "utf8"));
      if (mode !== "seed") await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`${mode === "seed" ? "Seeded" : "Applied"} ${file}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
} finally { await pool.end(); }
