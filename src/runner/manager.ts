import { executeServerRun } from "./run";

export interface IStartServerRunParams {
  readonly userId: string;
  readonly sessionId: string;
  readonly repo: { readonly url: string; readonly branch?: string };
  readonly prompt: string;
}

/** Live server runs, keyed by session id (one run per session). */
const active = new Map<string, Promise<void>>();

/**
 * Start a server run for a session and return once it's launched (not finished).
 * Deduped per session. The run narrates itself to the relay; callers don't await it.
 *
 * Phase 3a: runs in-process with the deterministic placeholder agent. 3b swaps this
 * for a per-run sandboxed child process hosting the real agent + toolset.
 */
export async function startServerRun(params: IStartServerRunParams): Promise<void> {
  if (active.has(params.sessionId)) return;
  const run = executeServerRun(params).finally(() => active.delete(params.sessionId));
  active.set(params.sessionId, run);
}

/** Whether a server run is currently executing for this session. */
export function hasActiveServerRun(sessionId: string): boolean {
  return active.has(sessionId);
}
