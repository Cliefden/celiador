// The per-user limits the daemon enforces on the hosted agent, read from its
// public /api/limits — the same object the app's account panel shows a
// signed-in user. The pricing page renders these so the site and the product
// state the same numbers (the conduct pledge: "we publish the numbers we
// enforce"). Server-only; revalidated every five minutes.

export type AgentLimits = {
  /** Requests per rolling minute. */
  rpm: number;
  /** Concurrent agent requests. */
  concurrency: number;
  /** Requests per UTC day. */
  dailyRequests: number;
  /** Input tokens per UTC day. */
  dailyInput: number;
  /** Output tokens per UTC day. */
  dailyOutput: number;
};

export type PublishedLimits = {
  plan: string;
  model: string;
  limits: AgentLimits;
  window: string;
  /** False when the live endpoint was unreachable and the documented defaults are shown instead. */
  live: boolean;
};

const API = (process.env.CELIADOR_LIMITS_API ?? "https://celiador.ai/api/limits").replace(/\/+$/, "");

/**
 * The daemon's documented defaults (daemon/src/agent/quota.ts). Only shown,
 * clearly labelled, when the live endpoint can't be reached at render time.
 */
const DOCUMENTED_DEFAULTS: PublishedLimits = {
  plan: "early-access",
  model: "claude-opus-4-8",
  limits: { rpm: 30, concurrency: 2, dailyRequests: 500, dailyInput: 5_000_000, dailyOutput: 300_000 },
  window: "Daily budgets reset at 00:00 UTC; the per-minute window and concurrency are instantaneous.",
  live: false,
};

export async function publishedLimits(): Promise<PublishedLimits> {
  try {
    const res = await fetch(API, { next: { revalidate: 300 } });
    if (!res.ok) return DOCUMENTED_DEFAULTS;
    const data = (await res.json()) as Partial<PublishedLimits>;
    if (!data.limits || typeof data.limits.dailyRequests !== "number") return DOCUMENTED_DEFAULTS;
    return {
      plan: data.plan ?? DOCUMENTED_DEFAULTS.plan,
      model: data.model ?? DOCUMENTED_DEFAULTS.model,
      limits: { ...DOCUMENTED_DEFAULTS.limits, ...data.limits },
      window: data.window ?? DOCUMENTED_DEFAULTS.window,
      live: true,
    };
  } catch {
    return DOCUMENTED_DEFAULTS;
  }
}

/** "unlimited" for 0, otherwise a grouped number. */
export function formatLimit(n: number): string {
  return n === 0 ? "unlimited" : n.toLocaleString("en-US");
}
