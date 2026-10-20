/**
 * Per-user editor control channel. An editor instance opens an SSE control stream
 * (`GET /api/presence/commands`) and the daemon pushes control commands to it —
 * today, "start a run on a local repo" requests the phone posts via
 * `POST /api/presence/requests`.
 *
 * This is how "Run on your editor" reaches the Mac without the phone cloning
 * anything: the editor already has the repo open (see {@link workspacePresence}),
 * so it runs the agent on the local working copy and the existing relay bridge
 * mirrors that session back to the phone. In-memory, best-effort, per process.
 */

/** A control command pushed to an editor. Only "start a run" exists today. */
export interface EditorRunRequest {
  readonly kind: "start-run";
  /** Correlates the phone's POST with the editor's acknowledgement (future use). */
  readonly requestId: string;
  /** Normalised https clone URL the editor matches against its open workspaces. */
  readonly remoteUrl: string;
  /** Workspace display name, for logging/UX on the editor side. */
  readonly name?: string;
  /** Branch to run against, when the phone specified one. */
  readonly branch?: string;
  /** What the agent should do — seeds the local agent-host session's first turn. */
  readonly prompt: string;
}

/**
 * Run a queued agent task in its own worktree (the agent-first queue, tasks/).
 * A separate kind so an editor that predates it ignores it rather than running
 * the task in the user's working copy.
 */
export interface EditorTaskRequest {
  readonly kind: "start-task";
  readonly taskId: string;
  readonly remoteUrl: string;
  readonly name?: string;
  /** The new branch (and worktree) the run works on. */
  readonly branch: string;
  readonly prompt: string;
  readonly title: string;
  /** Set when the task came from a GitHub issue: the PR closes it. */
  readonly issue?: { readonly number: number; readonly url: string };
}

export type EditorCommand = EditorRunRequest | EditorTaskRequest;

type Send = (command: EditorCommand) => void;

class EditorControl {
  private readonly byUser = new Map<string, Set<Send>>();

  /** Register an editor control stream; returns an unsubscribe function. */
  subscribe(userId: string, send: Send): () => void {
    const set = this.byUser.get(userId) ?? new Set<Send>();
    set.add(send);
    this.byUser.set(userId, set);
    return () => {
      const current = this.byUser.get(userId);
      if (!current) return;
      current.delete(send);
      if (current.size === 0) this.byUser.delete(userId);
    };
  }

  /** Fan a run request out to the user's connected editor(s). Returns how many got it. */
  request(userId: string, req: EditorCommand): number {
    const set = this.byUser.get(userId);
    if (!set || set.size === 0) return 0;
    for (const send of set) {
      try {
        send(req);
      } catch {
        /* best-effort: a dead stream is reaped on its own abort */
      }
    }
    return set.size;
  }

  /** How many editor control streams are currently connected for a user. */
  count(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Forget a user's editor streams entirely (e.g. account deletion). */
  clear(userId: string): void {
    this.byUser.delete(userId);
  }
}

/** Process-wide editor control bus, shared across requests. */
export const editorControl = new EditorControl();
