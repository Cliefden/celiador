import { publishSessionEvent } from "../sessions/publish";
import type { SessionEventInput } from "../sessions/types";
import { computeDiffs, workspaceDir } from "./workspace";
import { addWorktree } from "./worktrees";
import { placeholderAgent, type RunnerAgent } from "./agent";

export interface IServerRunOptions {
  readonly userId: string;
  readonly sessionId: string;
  /** `branch`: what to start from (default: the remote's default branch); `workBranch`: the worktree's own branch. */
  readonly repo: { readonly url: string; readonly branch?: string; readonly workBranch?: string };
  readonly prompt: string;
  /** Continue the agent's previous conversation in this run (a follow-up turn). */
  readonly continueConversation?: boolean;
  /** The agent to run (defaults to the Phase 3a placeholder). Injected for tests / 3b. */
  readonly agent?: RunnerAgent;
  /** Aborted when the user cancels the run. */
  readonly signal?: AbortSignal;
  /** Publisher override (defaults to the real relay). Injected for tests. */
  readonly publish?: (event: SessionEventInput) => void;
  /**
   * The caller has already put a checkout in the run's workspace (a cloud task's
   * prepared branch, or a follow-up turn in a retained workspace): skip the clone.
   */
  readonly workspaceReady?: boolean;
}

/** How a server run ended, for the caller that has to act on it (tasks/cloud.ts). */
export type IServerRunOutcome =
  | { readonly ok: true; readonly changedFiles: number; readonly finalMessage?: string }
  | { readonly ok: false; readonly cancelled: boolean; readonly error: string };

/**
 * Execute one server run end to end: clone → agent → diff → relay, then clean up.
 * Narrates progress to the session relay (state/activity/tool/diff/done/error) so a
 * watcher (phone) sees it live, exactly like an editor runner. Never throws — a
 * failure is reported as an `error` event and in the returned outcome, which also
 * carries the agent's last assistant message (the PR body's summary).
 *
 * Phase 3a runs in-process with the deterministic {@link placeholderAgent}; that is
 * safe because the placeholder executes no model-driven code. The real agent (3b)
 * MUST run in a sandbox (child process / container) before it is enabled.
 */
export async function executeServerRun(opts: IServerRunOptions): Promise<IServerRunOutcome> {
  const agent = opts.agent ?? placeholderAgent;
  const sink = opts.publish ?? ((event: SessionEventInput) => void publishSessionEvent(opts.userId, opts.sessionId, event));
  // The agent's own last assistant message is what the pull request summarises.
  let finalMessage: string | undefined;
  const publish = (event: SessionEventInput) => {
    if (event.kind === "message" && event.role === "assistant" && event.text.trim()) finalMessage = event.text;
    sink(event);
  };
  const dir = workspaceDir(opts.userId, opts.sessionId);

  try {
    publish({ kind: "state", state: "running" });
    if (!opts.workspaceReady) {
      publish({ kind: "activity", text: `Checking out ${opts.repo.url}…` });
      // Anonymous (public repos): callers that may use the GitHub App's token —
      // cloud sessions on a linked repo, cloud tasks — prepare the worktree
      // themselves (workspaceReady) after checking the user may use it.
      await addWorktree({
        userId: opts.userId,
        url: opts.repo.url,
        dir,
        branch: opts.repo.workBranch ?? `celiador/run-${opts.sessionId.slice(0, 8)}`,
        base: opts.repo.branch,
      });
    }

    publish({ kind: "activity", text: "Running the agent…" });
    await agent({ workspaceDir: dir, prompt: opts.prompt, publish, userId: opts.userId, runId: opts.sessionId, continueConversation: opts.continueConversation, signal: opts.signal ?? new AbortController().signal });

    const diffs = await computeDiffs(dir);
    for (const d of diffs) {
      publish({ kind: "diff", path: d.path, patch: d.patch });
    }
    const agentMessage = finalMessage;
    publish({
      kind: "message",
      role: "assistant",
      text: diffs.length ? `Done — changed ${diffs.length} file(s).` : "Done — no changes were needed.",
    });
    publish({ kind: "done" });
    publish({ kind: "state", state: "done" });
    return { ok: true, changedFiles: diffs.length, finalMessage: agentMessage };
  } catch (err) {
    if (opts.signal?.aborted) {
      publish({ kind: "state", state: "cancelled" });
      return { ok: false, cancelled: true, error: "cancelled" };
    }
    const raw = err instanceof Error ? err.message : String(err);
    // An anonymous clone of a private repo makes git try to prompt for credentials.
    const message = /could not read Username/i.test(raw)
      ? "Cloning failed — this repo looks private. Private repos need the Celiador GitHub App installed and the repo added to your repos."
      : raw;
    publish({ kind: "error", message });
    publish({ kind: "state", state: "error" });
    return { ok: false, cancelled: false, error: message };
  }
  // The workspace is intentionally retained after the run so the phone can browse
  // its files; it's reclaimed when the session is deleted (see DELETE /:id),
  // on account deletion (purgeUserRuns), and swept at daemon boot (reapOrphanRuns).
}
