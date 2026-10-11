import { COMPLETE_RPM, COMPLETE_DAILY_OUTPUT_TOKENS } from "../config";

/**
 * Per-user, in-memory rate limiting for inline completions. Deliberately
 * ephemeral (no disk store): completions are high-frequency and best-effort, so
 * a limiter that resets on restart is acceptable and keeps the hot path cheap.
 * Separate from the agent proxy's accounting — a user hammering Tab must not
 * eat into their chat/agent budget, and vice versa.
 */

interface UserWindow {
  /** Request timestamps (ms) within the last rolling minute. */
  requests: number[];
  /** Output tokens spent in the current UTC day, with the day it belongs to. */
  dayTokens: number;
  dayStart: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const windows = new Map<string, UserWindow>();

export interface RateDecision {
  ok: boolean;
  /** Seconds the client should wait before retrying (set when !ok). */
  retryAfter?: number;
}

/** Charge one request against the per-minute and per-day budgets. */
export function checkAndCount(userId: string, now: number): RateDecision {
  let w = windows.get(userId);
  if (!w) {
    w = { requests: [], dayTokens: 0, dayStart: now };
    windows.set(userId, w);
  }

  // Roll the day budget over.
  if (now - w.dayStart >= DAY_MS) {
    w.dayStart = now;
    w.dayTokens = 0;
  }

  if (w.dayTokens >= COMPLETE_DAILY_OUTPUT_TOKENS) {
    const retryAfter = Math.ceil((w.dayStart + DAY_MS - now) / 1000);
    return { ok: false, retryAfter: Math.max(retryAfter, 1) };
  }

  // Drop request timestamps older than a minute, then check the RPM cap.
  const cutoff = now - MINUTE_MS;
  w.requests = w.requests.filter((t) => t > cutoff);
  if (w.requests.length >= COMPLETE_RPM) {
    const oldest = w.requests[0]!;
    const retryAfter = Math.ceil((oldest + MINUTE_MS - now) / 1000);
    return { ok: false, retryAfter: Math.max(retryAfter, 1) };
  }

  w.requests.push(now);
  return { ok: true };
}

/** Record output tokens spent so the daily budget can be enforced. */
export function recordOutputTokens(userId: string, tokens: number, now: number): void {
  const w = windows.get(userId);
  if (!w) return;
  if (now - w.dayStart >= DAY_MS) {
    w.dayStart = now;
    w.dayTokens = 0;
  }
  w.dayTokens += Math.max(0, tokens);
}
