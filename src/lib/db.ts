import { Pool, type PoolClient } from "pg";

const globalDatabase = globalThis as typeof globalThis & { feedbackFlowPool?: Pool };

export function persistenceMode(): "memory" | "postgres" {
  const configured = process.env.PERSISTENCE_MODE;
  if (configured === "memory" || configured === "postgres") return configured;
  if (process.env.NODE_ENV === "test") return "memory";
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

export function databasePool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=postgres");
  globalDatabase.feedbackFlowPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
  return globalDatabase.feedbackFlowPool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseHealth(): Promise<boolean> {
  if (persistenceMode() === "memory") return true;
  try { await databasePool().query("SELECT 1"); return true; } catch { return false; }
}
