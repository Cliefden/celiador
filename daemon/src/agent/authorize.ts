import type { Context } from "hono";
import type { AuthResult } from "../auth";
import { authenticateToken, bearerFrom, safeEqual } from "../auth";
import { agentQuota } from "./quota";
import { dbEnabled } from "../db/pool";
import { getProfile } from "../db/repo";

/**
 * Shared authorization spine for the Anthropic-backed endpoints (the locked
 * agent proxy in anthropic.ts and the first-party gateway in gateway.ts). It is
 * the single place that decides *who may spend the daemon's paid key*, so the two
 * endpoints can never drift apart on auth, plan gating or quota.
 *
 * Accepts EITHER a valid Supabase user JWT (the normal per-user path) OR the
 * CELIADOR_AGENT_TOKEN shared secret (keyless/dev/ops fallback). Applies the
 * optional CELIADOR_AGENT_PLANS gate (real users only) and acquires a per-user
 * quota slot. On success returns the resolved user, a quota key and a `release`
 * the caller MUST invoke in a finally block.
 */

/** Plans allowed to use the agent (CELIADOR_AGENT_PLANS, comma-separated). Unset = any plan. */
function allowedPlans(): Set<string> | null {
  const raw = process.env.CELIADOR_AGENT_PLANS?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((p) => p.trim()).filter(Boolean));
}

export type AuthorizeResult =
  | { ok: true; user: AuthResult | null; quotaKey: string; isRunner: boolean; release: () => void }
  | { ok: false; status: 401 | 403 | 429 | 503; error: string; retryAfter?: number };

export async function authorizeAgent(c: Context): Promise<AuthorizeResult> {
  const bearer = bearerFrom(c);
  const user = authenticateToken(bearer);
  const sharedOk = safeEqual(bearer, process.env.CELIADOR_AGENT_TOKEN);
  if (!user && !sharedOk) return { ok: false, status: 401, error: "unauthorized" };
  const quotaKey = user?.userId ?? "shared-agent-token";

  // Optional plan gate (only meaningful for real users; the shared token is ops-only).
  const plans = allowedPlans();
  if (plans && user && !sharedOk) {
    if (!dbEnabled()) return { ok: false, status: 503, error: "plan check unavailable" };
    const profile = await getProfile(user.userId).catch(() => null);
    if (!profile || !plans.has(profile.plan)) {
      return { ok: false, status: 403, error: "Your plan doesn't include the Celiador agent." };
    }
  }

  const slot = agentQuota.acquire(quotaKey);
  if ("error" in slot) return { ok: false, status: 429, error: slot.error, retryAfter: slot.retryAfter };

  return { ok: true, user, quotaKey, isRunner: user?.runner === true, release: slot.release };
}
