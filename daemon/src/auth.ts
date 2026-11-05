import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deletedUsers } from "./deleted-users";

/**
 * Three auth modes, decided by environment (unchanged from the old daemon so
 * existing clients and the same .env keep working):
 *  - "supabase": SUPABASE_JWT_SECRET set — verify HS256 JWTs; `sub` is the user id.
 *  - "token":    CELIADOR_TOKEN set — shared secret; single "default" user.
 *  - "none":     localhost dev — single "default" user.
 */

export type AuthMode = "supabase" | "token" | "none";

export interface AuthResult {
  userId: string;
  email?: string;
  /** True when the token is a daemon-minted server-runner token (see mintRunnerToken). */
  runner?: boolean;
  /** The server-run id this runner token is scoped to, when `runner` is true. */
  runId?: string;
}

/** Hono variables carried on authenticated requests. */
export type AppEnv = { Variables: { user: AuthResult } };

export function authMode(): AuthMode {
  if (process.env.SUPABASE_JWT_SECRET) return "supabase";
  if (process.env.CELIADOR_TOKEN) return "token";
  return "none";
}

/** True for loopback bind addresses (the only place "none" mode is acceptable). */
function isLoopback(host: string | undefined): boolean {
  return !host || host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Fail closed: refuse to boot in "none" (no-auth) mode unless explicitly allowed
 * for local dev. The daemon binds 127.0.0.1 even in prod (Caddy fronts it), so the
 * bind address alone can't tell dev from prod — a prod env file that lost its
 * SUPABASE_JWT_SECRET would otherwise open every endpoint, including the paid
 * Anthropic proxy. Local dev: set CELIADOR_ALLOW_NO_AUTH=1 (the dev template does).
 */
export function assertAuthConfigured(): void {
  if (authMode() !== "none") return;
  if (process.env.CELIADOR_ALLOW_NO_AUTH === "1" && isLoopback(process.env.HOST)) {
    console.warn("Auth mode \"none\": every request is the single \"default\" user (local dev only).");
    return;
  }
  console.error(
    "Refusing to start: no SUPABASE_JWT_SECRET or CELIADOR_TOKEN is set (auth mode would be \"none\").\n" +
      "For local dev on a loopback HOST, set CELIADOR_ALLOW_NO_AUTH=1."
  );
  process.exit(1);
}

/** Constant-time string compare (for shared secrets). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Verify a Supabase HS256 access token. Returns null if invalid/expired. */
export function verifySupabaseJwt(token: string): AuthResult | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(parts[2]!, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  const header = b64urlJson(parts[0]!);
  const payload = b64urlJson(parts[1]!);
  if (header?.alg !== "HS256" || !payload) return null;
  // exp is mandatory (a token without one would never expire).
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  // GoTrue issues aud "authenticated"; reject anything else (override via SUPABASE_JWT_AUD).
  const aud = process.env.SUPABASE_JWT_AUD || "authenticated";
  const tokenAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.aud !== undefined && !tokenAud.includes(aud)) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  // Only end-user tokens grant access — not anon/service keys. Daemon-minted
  // runner tokens (mintRunnerToken) also carry role "authenticated" but come
  // back marked `runner`, and only the agent gateway accepts those (requireUser
  // and authorizeAgent refuse them everywhere else).
  if (payload.role !== "authenticated") return null;

  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    runner: payload.celiador_runner === true,
    runId: typeof payload.celiador_run === "string" ? payload.celiador_run : undefined,
  };
}

/**
 * Mint a short-lived, user-scoped JWT for a server-side runner (see src/runner).
 * It is Supabase-shaped — role "authenticated", `sub` = the owning user — so it
 * passes verifySupabaseJwt, but two extra claims mark it: `celiador_runner` and
 * `celiador_run` (the run it belongs to, for cost attribution).
 *
 * Celiador edit (cloud-session hardening): a runner token is good for the
 * Anthropic gateway (/api/anthropic/*) ONLY. It sits inside the sandbox, in
 * reach of a possibly prompt-injected agent, so it must not be able to start
 * sessions, drive the git review API (which pushes/merges with the GitHub App),
 * touch profile/chats or delete the account. requireUser refuses it with 403;
 * authorizeAgent accepts it only when the route opts in (the gateway). Signed
 * with the same SUPABASE_JWT_SECRET; returns null when that isn't configured.
 */
export function mintRunnerToken(userId: string, runId: string, ttlSeconds = 7200): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const aud = process.env.SUPABASE_JWT_AUD || "authenticated";
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    role: "authenticated",
    aud,
    iss: "celiador-daemon",
    celiador_runner: true,
    celiador_run: runId,
    iat: now,
    exp: now + ttlSeconds,
  };
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${sig}`;
}

/**
 * The bearer token from the Authorization header. (The old `?token=` query
 * fallback was removed: it put JWTs into proxy access logs, and no current client
 * — editor or iOS — uses it; both set the header on their SSE requests.)
 */
export function bearerFrom(c: Context): string | null {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Resolve a token to a user per the active auth mode, or null. */
export function authenticateToken(token: string | null): AuthResult | null {
  switch (authMode()) {
    case "supabase":
      return token ? verifySupabaseJwt(token) : null;
    case "token":
      return safeEqual(token, process.env.CELIADOR_TOKEN) ? { userId: "default" } : null;
    case "none":
      return { userId: "default" };
  }
}

/** The refusal for a runner token on a route other than the gateway. */
export const RUNNER_TOKEN_REFUSED = "runner tokens are only valid on the agent gateway";

/**
 * Middleware: require a valid end user; stashes it as c.get("user"). Runner
 * tokens are refused (403): no route behind requireUser is one the sandboxed
 * agent needs — its events reach the relay through the daemon process, not HTTP.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = authenticateToken(bearerFrom(c));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.runner) return c.json({ error: RUNNER_TOKEN_REFUSED }, 403);
  // Block deleted users even if their JWT is still valid
  if (deletedUsers.isDeleted(user.userId)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", user);
  await next();
};
