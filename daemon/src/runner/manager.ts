import { executeServerRun, type IServerRunOutcome } from "./run";
import { placeholderAgent, type RunnerAgent } from "./agent";
import { sandboxAgent, sandboxAvailable } from "./sandbox";

export interface IStartServerRunParams {
  readonly userId: string;
  readonly sessionId: string;
  readonly repo: { readonly url: string; readonly branch?: string };
  readonly prompt: string;
  /** See IServerRunOptions.workspaceReady. */
  readonly workspaceReady?: boolean;
}

/** Live server runs, keyed by session id (one run per session), with their cancel switch. */
const active = new Map<string, { readonly run: Promise<IServerRunOutcome>; readonly abort: AbortController }>();

/**
 * Test seam: a fake agent (and availability) in place of the sandbox, so the
 * cloud-task path can run in the smoke test without Docker. Also switches
 * {@link cloudRunsEnabled} on.
 */
let override: { agent: RunnerAgent; available?: () => Promise<string | undefined> } | undefined;
export function overrideServerRunnerForTests(o?: { agent: RunnerAgent; available?: () => Promise<string | undefined> }): void {
  override = o;
}

/**
 * Whether queued tasks may fall back to the cloud: only with the real sandboxed
 * agent (CELIADOR_RUNNER_AGENT=sandbox). The placeholder agent never takes a
 * task — it would open an empty pull request.
 */
export function cloudRunsEnabled(): boolean {
  return !!override || process.env.CELIADOR_RUNNER_AGENT === "sandbox";
}

/** Why a cloud run can't start right now (Docker / image missing), or undefined when it can. */
export function cloudRunnerAvailable(): Promise<string | undefined> {
  if (override) return override.available ? override.available() : Promise.resolve(undefined);
  if (!cloudRunsEnabled()) return Promise.resolve("cloud runs are off on this server (CELIADOR_RUNNER_AGENT is not \"sandbox\")");
  return sandboxAvailable();
}

/**
 * Which agent cloud runs use. `sandbox` = the real Claude agent in a per-run
 * locked-down container (Phase 3b, sandbox.ts); anything else = the Phase 3a
 * deterministic placeholder, which executes no model-driven code. Opt-in so a
 * box without the runner image keeps working exactly as before.
 */
export function serverRunAgent(): RunnerAgent {
  if (override) return override.agent;
  return process.env.CELIADOR_RUNNER_AGENT === "sandbox" ? sandboxAgent : placeholderAgent;
}

/**
 * Run a server run for a session to completion, with its cancel switch registered
 * while it lasts. Deduped per session: a second call while one is active joins
 * it. The run narrates itself to the relay; the outcome is for the caller that
 * has to finish the job (push, open the PR — tasks/cloud.ts).
 */
export function runServerRun(params: IStartServerRunParams): Promise<IServerRunOutcome> {
  const existing = active.get(params.sessionId);
  if (existing) return existing.run;
  const abort = new AbortController();
  const run = executeServerRun({ ...params, agent: serverRunAgent(), signal: abort.signal }).finally(() => active.delete(params.sessionId));
  active.set(params.sessionId, { run, abort });
  return run;
}

/**
 * Start a server run for a session and return once it's launched (not finished).
 * Deduped per session. The run narrates itself to the relay; callers don't await it.
 */
export async function startServerRun(params: IStartServerRunParams): Promise<void> {
  void runServerRun(params);
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
