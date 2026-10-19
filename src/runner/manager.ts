import { executeServerRun } from "./run";
import { placeholderAgent, type RunnerAgent } from "./agent";
import { sandboxAgent } from "./sandbox";

export interface IStartServerRunParams {
  readonly userId: string;
  readonly sessionId: string;
  readonly repo: { readonly url: string; readonly branch?: string };
  readonly prompt: string;
}

/** Live server runs, keyed by session id (one run per session), with their cancel switch. */
const active = new Map<string, { readonly run: Promise<void>; readonly abort: AbortController }>();

/**
 * Which agent cloud runs use. `sandbox` = the real Claude agent in a per-run
 * locked-down container (Phase 3b, sandbox.ts); anything else = the Phase 3a
 * deterministic placeholder, which executes no model-driven code. Opt-in so a
 * box without the runner image keeps working exactly as before.
 */
export function serverRunAgent(): RunnerAgent {
  return process.env.CELIADOR_RUNNER_AGENT === "sandbox" ? sandboxAgent : placeholderAgent;
}

/**
 * Start a server run for a session and return once it's launched (not finished).
 * Deduped per session. The run narrates itself to the relay; callers don't await it.
 */
export async function startServerRun(params: IStartServerRunParams): Promise<void> {
  if (active.has(params.sessionId)) return;
  const abort = new AbortController();
  const run = executeServerRun({ ...params, agent: serverRunAgent(), signal: abort.signal }).finally(() => active.delete(params.sessionId));
  active.set(params.sessionId, { run, abort });
}

/** Whether a server run is currently executing for this session. */
export function hasActiveServerRun(sessionId: string): boolean {
  return active.has(sessionId);
}

/** Cancel a running server run (kills its sandbox); false when none is running. */
export function cancelServerRun(sessionId: string): boolean {
  const entry = active.get(sessionId);
  if (!entry) return false;
  entry.abort.abort();
  return true;
}
