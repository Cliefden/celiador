import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

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
  // Only end-user tokens grant access — not anon/service keys.
  if (payload.role !== "authenticated") return null;

  return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
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

/** Middleware: require a valid user; stashes it as c.get("user"). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = authenticateToken(bearerFrom(c));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};
