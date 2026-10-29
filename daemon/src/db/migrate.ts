// Must stay the FIRST import: loads the env's .env (DATABASE_URL) like main.ts does.
import "../env";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

/**
 * Forward-only SQL migrations for the daemon's app data (`db/migrations/*.sql`).
 *
 *   npm run migrate            # apply every file not yet in schema_migrations
 *   npm run migrate -- --dry   # list what would be applied
 *
 * Each file runs once, in filename order, inside its own transaction, and is
 * recorded in `public.schema_migrations` by name. A file that was already applied
 * is never re-run — editing an applied file does nothing; write a new one. There
 * is no "down": rolling back code never rolls back the schema (ENVIRONMENTS.md).
 *
 * The deploy runs this on every dev push and every test tag, on prod only when
 * asked. Migrations 0001 and 0002 were applied to prod by hand before this
 * runner existed; `--baseline` records them without running them.
 *
 * Needs DATABASE_URL (the env's .env; loaded by ./env like the daemon).
 */

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, "..", "..", "db", "migrations");

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const baseline = process.argv.includes("--baseline");
  if (!process.env.DATABASE_URL) {
    console.error("migrate: DATABASE_URL is not set");
    process.exit(2);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await pool.query(
      `create table if not exists public.schema_migrations (
         name       text primary key,
         applied_at timestamptz not null default now()
       )`
    );
    const { rows } = await pool.query<{ name: string }>("select name from public.schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(`migrate: up to date (${files.length} applied)`);
      return;
    }
    for (const file of pending) {
      if (dry) {
        console.log(`migrate: would apply ${file}`);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        if (baseline) {
          console.log(`migrate: baseline ${file} (recorded, not run)`);
        } else {
          console.log(`migrate: applying ${file}`);
          await client.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
        }
        await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        console.error(`migrate: ${file} failed — rolled back:`, err instanceof Error ? err.message : err);
        process.exit(1);
      } finally {
        client.release();
      }
    }
    console.log(`migrate: done (${pending.length} applied)`);
  } finally {
    await pool.end();
  }
}

await main();
