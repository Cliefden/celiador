import { Pool } from "pg";

/**
 * Lazy Postgres pool for durable app data (profiles, chat history) in the
 * Celiador Supabase DB. Configured by `DATABASE_URL` (a direct/pooler connection
 * string). When unset, the DB layer is a **no-op** — the daemon runs fine without
 * it (mirrors how APNs is a no-op without APNS_*), so local dev needs no database.
 *
 * The daemon connects as a trusted role (owner/service), so its writes bypass RLS;
 * clients that read directly via PostgREST are still RLS-scoped. See docs/DATA_MODEL.md.
 */

let pool: Pool | null = null;

export function dbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getPool(): Pool | null {
  if (!dbEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      // Supabase self-hosted certs are typically not in the system trust store;
      // the connection is loopback on the box, so don't demand a verified cert.
      ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
