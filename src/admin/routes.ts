import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { getPool } from "../db/pool";
import { agentQuota } from "../agent/quota";

/**
 * Operator views, for the accounts listed in CELIADOR_ADMIN_USER_IDS
 * (comma-separated Supabase user ids). Everyone else gets 404, as if the route
 * didn't exist. Read-only.
 *
 *   GET /api/admin/usage?days=30 — the paid key's use per UTC day (today live),
 *   per account, with the account's email and signup date so an unfamiliar
 *   spender stands out.
 */

function admins(): Set<string> {
  return new Set((process.env.CELIADOR_ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

async function accounts(ids: string[]): Promise<Map<string, { email: string | null; createdAt: string | null }>> {
  const out = new Map<string, { email: string | null; createdAt: string | null }>();
  const pool = getPool();
  if (!pool || ids.length === 0) return out;
  try {
    const res = await pool.query<{ id: string; email: string | null; created_at: Date | null }>(
      "select id::text as id, email, created_at from auth.users where id::text = any($1)",
      [ids]
    );
    for (const r of res.rows) out.set(r.id, { email: r.email, createdAt: r.created_at?.toISOString() ?? null });
  } catch (err) {
    console.error("[admin] account lookup failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

export function adminRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);
  app.use("*", async (c, next) => {
    if (!admins().has(c.get("user").userId)) return c.json({ error: "not found" }, 404);
    await next();
  });

  app.get("/usage", async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
    const report = agentQuota.report(days);
    const ids = [...new Set(report.flatMap((d) => Object.keys(d.users)))];
    const who = await accounts(ids);
    return c.json({
      days: report.map((d) => ({
        day: d.day,
        total: d.total,
        accounts: d.accounts,
        users: Object.entries(d.users)
          .map(([userId, u]) => ({ userId, ...(who.get(userId) ?? { email: null, createdAt: null }), ...u }))
          .sort((a, b) => b.inputTokens - a.inputTokens),
      })),
    });
  });

  return app;
}
