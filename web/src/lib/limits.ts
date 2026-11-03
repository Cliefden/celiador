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
  /** Agent usage per UTC day, in US dollars at each model's list price (cache reads and writes at their own rates). */
  dailyUsd: number;
  /** Optional hard cap: input tokens per UTC day (0 = off, the default). */
  dailyInput: number;
  /** Optional hard cap: output tokens per UTC day (0 = off, the default). */
  dailyOutput: number;
};

export type PublishedLimits = {
  plan: string;
  model: string;
  limits: AgentLimits;
  /** Agent tasks (queued GitHub issues) running at once per user. */
  tasks: { concurrency: number };
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
  limits: { rpm: 30, concurrency: 2, dailyRequests: 500, dailyUsd: 10, dailyInput: 0, dailyOutput: 0 },
  tasks: { concurrency: 3 },
  window: "Daily budgets (requests, dollars) reset at 00:00 UTC; the per-minute window and concurrency are instantaneous.",
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
      // A daemon from before the dollar budget sends no dailyUsd: it enforces none (0 = unlimited).
      limits: { ...DOCUMENTED_DEFAULTS.limits, dailyUsd: 0, ...(data.limits as Partial<AgentLimits>) },
      tasks: { ...DOCUMENTED_DEFAULTS.tasks, ...(data.tasks ?? {}) },
      window: data.window ?? DOCUMENTED_DEFAULTS.window,
      live: true,
    };
  } catch {
    return DOCUMENTED_DEFAULTS;
  }
}

/** "unlimited" for 0, otherwise whole dollars (cents when not whole). */
export function formatUsdLimit(n: number): string {
  if (n === 0) return "unlimited";
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

/** "unlimited" for 0, otherwise a grouped number. */
export function formatLimit(n: number): string {
  return n === 0 ? "unlimited" : n.toLocaleString("en-US");
}
