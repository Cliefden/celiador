import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { dbEnabled } from "../db/pool";
import { getProfile } from "../db/repo";
import { agentQuota } from "../agent/quota";
import { taskConcurrency, taskStores } from "../tasks/dispatch";

/**
 * The one number the plan steers by, per user: agent pull requests merged in
 * the last seven days — plus what is open or running now. Computed from the
 * task store the daemon already keeps; nothing new is collected.
 */
function taskSummary(userId: string): { running: number; prOpen: number; mergedLast7Days: number; concurrency: number } {
  const since = Date.now() - 7 * 86_400_000;
  let running = 0, prOpen = 0, mergedLast7Days = 0;
  for (const t of taskStores.for(userId).list()) {
    if (t.state === "dispatched" || t.state === "running") running++;
    else if (t.state === "pr-open") prOpen++;
    else if (t.state === "merged" && Date.parse(t.updatedAt) >= since) mergedLast7Days++;
  }
  return { running, prOpen, mergedLast7Days, concurrency: taskConcurrency() };
}

/**
 * `GET /api/me` — the signed-in account summary the editor/iOS account panel reads:
 * identity, plan, and the caller's current daily agent usage against the active
 * quota. Usage is tracked server-side by {@link agentQuota} (the only place the
 * paid key is metered); this is the one read-back of it. Profile is best-effort —
 * absent in token/none auth mode (no DB) and for a Supabase user with no row yet —
 * so the panel always renders, usage included.
 *
 * Mounted at /api/me (its own prefix, like /api/profile) so requireUser never
 * shadows the public /api/health & /api/config.
 */
export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/", async (c) => {
    const user = c.get("user");
    const profile = dbEnabled() ? await getProfile(user.userId).catch(() => null) : null;
    const { usage, limits, resetsAt } = agentQuota.snapshot(user.userId);
    return c.json({
      userId: user.userId,
      email: profile?.email ?? user.email ?? null,
      // null in token/none (self-host/dev) mode and before a profile row exists;
      // the panel renders that as a local/unknown plan rather than a billing tier.
      plan: profile?.plan ?? null,
      usage,
      limits,
      resetsAt,
      tasks: taskSummary(user.userId),
    });
  });

  return app;
}
