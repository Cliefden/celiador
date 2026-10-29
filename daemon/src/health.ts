/**
 * In-process failure counters for the background work that otherwise only
 * logs: the Supabase chat-history mirror and APNs pushes. Exposed on
 * GET /api/health so a failure that never reaches a user (the chats mirror
 * failed every write for weeks, 2026-10) shows up to anyone — or any uptime
 * check — looking. Counts and timestamps only, never messages: the endpoint
 * is public. Reset when the process restarts.
 */

export type FailureKind = "persist" | "push";

interface Counter {
  count: number;
  lastAt: string | null;
}

const failures: Record<FailureKind, Counter> = {
  persist: { count: 0, lastAt: null },
  push: { count: 0, lastAt: null },
};

const startedAt = new Date().toISOString();

export function recordFailure(kind: FailureKind): void {
  failures[kind].count++;
  failures[kind].lastAt = new Date().toISOString();
}

/** The counters as served by /api/health. */
export function failureReport(): { since: string } & Record<FailureKind, Counter> {
  return { since: startedAt, persist: { ...failures.persist }, push: { ...failures.push } };
}
