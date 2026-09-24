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
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  // Only end-user tokens grant access — not anon/service keys.
  if (payload.role !== "authenticated") return null;

  return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
}

/** The bearer token, falling back to ?token= (EventSource can't set headers). */
export function bearerFrom(c: Context): string | null {
  const header = c.req.header("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  return bearer ?? c.req.query("token") ?? null;
}

/** Resolve a token to a user per the active auth mode, or null. */
export function authenticateToken(token: string | null): AuthResult | null {
  switch (authMode()) {
    case "supabase":
      return token ? verifySupabaseJwt(token) : null;
    case "token":
      return token === process.env.CELIADOR_TOKEN ? { userId: "default" } : null;
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
