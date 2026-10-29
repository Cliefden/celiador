import { publishSessionEvent } from "../sessions/publish";
import type { SessionEventInput } from "../sessions/types";
import { cloneRepo, computeDiffs, workspaceDir } from "./workspace";
import { placeholderAgent, type RunnerAgent } from "./agent";
import { installationToken } from "../github/app";

/** `owner` + `name` of a github.com https URL, else undefined. */
function parseGitHubUrl(url: string): { owner: string; name: string } | undefined {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url);
  return m?.[1] && m[2] ? { owner: m[1], name: m[2] } : undefined;
}

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
      publish({ kind: "activity", text: `Cloning ${opts.repo.url}…` });
      // A GitHub App installation token (when the app is set up and installed on
      // the repo) lets private repositories clone; public ones work without it.
      const gh = parseGitHubUrl(opts.repo.url);
      const token = gh ? await installationToken(gh).catch(() => null) : null;
      await cloneRepo(opts.repo.url, opts.repo.branch, dir, token ?? undefined);
    }

    publish({ kind: "activity", text: "Running the agent…" });
    await agent({ workspaceDir: dir, prompt: opts.prompt, publish, userId: opts.userId, runId: opts.sessionId, signal: opts.signal ?? new AbortController().signal });

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
      ? "Cloning failed — this repo looks private. Cloud runs can only clone public repos for now."
      : raw;
    publish({ kind: "error", message });
    publish({ kind: "state", state: "error" });
    return { ok: false, cancelled: false, error: message };
  }
  // The workspace is intentionally retained after the run so the phone can browse
  // its files; it's reclaimed when the session is deleted (see DELETE /:id),
  // on account deletion (purgeUserRuns), and swept at daemon boot (reapOrphanRuns).
}
