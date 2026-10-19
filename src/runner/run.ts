import { publishSessionEvent } from "../sessions/publish";
import type { SessionEventInput } from "../sessions/types";
import { cloneRepo, computeDiffs, workspaceDir } from "./workspace";
import { placeholderAgent, type RunnerAgent } from "./agent";

export interface IServerRunOptions {
  readonly userId: string;
  readonly sessionId: string;
  readonly repo: { readonly url: string; readonly branch?: string };
  readonly prompt: string;
  /** The agent to run (defaults to the Phase 3a placeholder). Injected for tests / 3b. */
  readonly agent?: RunnerAgent;
  /** Aborted when the user cancels the run. */
  readonly signal?: AbortSignal;
  /** Publisher override (defaults to the real relay). Injected for tests. */
  readonly publish?: (event: SessionEventInput) => void;
}

/**
 * Execute one server run end to end: clone → agent → diff → relay, then clean up.
 * Narrates progress to the session relay (state/activity/tool/diff/done/error) so a
 * watcher (phone) sees it live, exactly like an editor runner. Never throws — a
 * failure is reported as an `error` event.
 *
 * Phase 3a runs in-process with the deterministic {@link placeholderAgent}; that is
 * safe because the placeholder executes no model-driven code. The real agent (3b)
 * MUST run in a sandbox (child process / container) before it is enabled.
 */
export async function executeServerRun(opts: IServerRunOptions): Promise<void> {
  const agent = opts.agent ?? placeholderAgent;
  const publish = opts.publish ?? ((event: SessionEventInput) => void publishSessionEvent(opts.userId, opts.sessionId, event));
  const dir = workspaceDir(opts.userId, opts.sessionId);

  try {
    publish({ kind: "state", state: "running" });
    publish({ kind: "activity", text: `Cloning ${opts.repo.url}…` });
    await cloneRepo(opts.repo.url, opts.repo.branch, dir);

    publish({ kind: "activity", text: "Running the agent…" });
    await agent({ workspaceDir: dir, prompt: opts.prompt, publish, userId: opts.userId, runId: opts.sessionId, signal: opts.signal ?? new AbortController().signal });

    const diffs = await computeDiffs(dir);
    for (const d of diffs) {
      publish({ kind: "diff", path: d.path, patch: d.patch });
    }
    publish({
      kind: "message",
      role: "assistant",
      text: diffs.length ? `Done — changed ${diffs.length} file(s).` : "Done — no changes were needed.",
    });
    publish({ kind: "done" });
    publish({ kind: "state", state: "done" });
  } catch (err) {
    if (opts.signal?.aborted) {
      publish({ kind: "state", state: "cancelled" });
      return;
    }
    const raw = err instanceof Error ? err.message : String(err);
    // An anonymous clone of a private repo makes git try to prompt for credentials.
    const message = /could not read Username/i.test(raw)
      ? "Cloning failed — this repo looks private. Cloud runs can only clone public repos for now."
      : raw;
    publish({ kind: "error", message });
    publish({ kind: "state", state: "error" });
  }
  // The workspace is intentionally retained after the run so the phone can browse
  // its files; it's reclaimed when the session is deleted (see DELETE /:id),
  // on account deletion (purgeUserRuns), and swept at daemon boot (reapOrphanRuns).
}
