import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { authMode, requireUser } from "../auth";
import { getPool } from "../db/pool";
import { pushStores } from "../push/instance";
import { sessionStores } from "../sessions/instance";
import { workspacePresence } from "../presence/workspaces";
import { purgeUserRuns } from "../runner/workspace";

/**
 * Account self-service. `DELETE /api/account` permanently deletes the caller's
 * account — required in-app by App Store guideline 5.1.1(v):
 *
 *  1. the GoTrue user (via the admin API, authorized with a short-lived
 *     service_role JWT minted from SUPABASE_JWT_SECRET — or, if that's not
 *     reachable, a direct `delete from auth.users` over DATABASE_URL). Deleting
 *     auth.users cascades to public.profiles / chats / messages.
 *  2. the daemon's own per-user files: relay sessions + event logs and push tokens.
 *
 * Only meaningful in "supabase" auth mode (token/none modes have a single shared
 * "default" user, which is not a deletable account).
 */
export function accountRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.delete("/", async (c) => {
    if (authMode() !== "supabase") return c.json({ error: "Account deletion needs a signed-in account." }, 400);
    const userId = c.get("user").userId;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return c.json({ error: "Unexpected user id." }, 400);

    const deleted = (await deleteViaGoTrue(userId)) || (await deleteViaDatabase(userId));
    if (!deleted) return c.json({ error: "Couldn't delete the account right now. Please try again later." }, 502);

    // Belt and braces: app rows cascade from auth.users, but clear them explicitly
    // in case the DB is separate from the auth store.
    const pool = getPool();
    if (pool) {
      await pool.query("delete from public.chats where user_id = $1", [userId]).catch(() => undefined);
      await pool.query("delete from public.profiles where id = $1", [userId]).catch(() => undefined);
    }
    sessionStores.purge(userId);
    pushStores.purge(userId);
    workspacePresence.clear(userId);
    await purgeUserRuns(userId); // server-run workspaces (best-effort)
    return c.json({ ok: true });
  });

  return app;
}

/** Base URL of the GoTrue admin API: GOTRUE_URL (direct) or SUPABASE_URL + /auth/v1. */
function gotrueBase(): string | null {
  const direct = process.env.GOTRUE_URL?.replace(/\/+$/, "");
  if (direct) return direct;
  const supabase = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  return supabase ? `${supabase}/auth/v1` : null;
}

/** A 60-second service_role JWT signed with the env's GoTrue secret. */
function serviceRoleJwt(): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role", iss: "celiador-daemon", iat: now, exp: now + 60 })}`;
  const sig = crypto.createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${sig}`;
}

async function deleteViaGoTrue(userId: string): Promise<boolean> {
  const base = gotrueBase();
  const jwt = serviceRoleJwt();
  if (!base || !jwt) return false;
  try {
    const res = await fetch(`${base}/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: process.env.SUPABASE_ANON_KEY ?? jwt,
      },
      signal: AbortSignal.timeout(10_000),
    });
    // 404: already gone — treat as deleted.
    if (res.ok || res.status === 404) return true;
    console.error(`[account] GoTrue admin delete → HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.error("[account] GoTrue admin delete failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function deleteViaDatabase(userId: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query("delete from auth.users where id = $1", [userId]);
    return true;
  } catch (err) {
    console.error("[account] auth.users delete failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
