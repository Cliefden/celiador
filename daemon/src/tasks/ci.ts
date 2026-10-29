import { postChecksFailedComment } from "./comments";
import { taskStores } from "./dispatch";
import { followUpTask } from "./followup";
import type { Task, TaskCi } from "./store";

/**
 * Checks failing → the agent fixes them. A `check_suite` / `check_run` that
 * completed with failure or timed_out on a pr-open task's branch becomes a
 * follow-up ("The CI checks failed on pull request #n (…). Investigate and fix,
 * then commit."), once per head sha and at most CELIADOR_TASK_CI_FIX_ATTEMPTS
 * (default 2) times per task. With no runner to send it to, the fix waits for one
 * (retried from dispatchTasks when an editor connects). The issue is told either
 * way (comments.ts).
 */

export function ciFixAttempts(): number {
  const n = Number(process.env.CELIADOR_TASK_CI_FIX_ATTEMPTS ?? 2);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

export interface CiFailure {
  /** The head commit the checks ran on. */
  readonly sha: string;
  readonly prNumber?: number;
  /** The failed checks' names (as many as the event / API gave). */
  readonly names: string[];
  readonly urls: string[];
}

function fixText(task: Task, f: CiFailure): string {
  const n = f.prNumber ?? task.pr?.number;
  const names = f.names.length ? f.names.join(", ") : "checks";
  const details = f.urls.length ? f.urls.join(", ") : task.pr?.url ?? task.prUrl ?? "see the pull request";
  return `The CI checks failed on pull request #${n ?? "?"} (${names}). Details: ${details}. Investigate and fix, then commit.`;
}

/** CI failed on `task`'s PR: send the fix (or park it), and narrate on the issue. */
export async function checksFailed(userId: string, taskId: string, failure: CiFailure): Promise<void> {
  const store = taskStores.for(userId);
  const task = store.get(taskId);
  if (!task || task.state !== "pr-open" || !failure.sha) return;
  const ci: TaskCi = { attempts: 0, shas: [], ...task.ci };
  if (ci.shas.includes(failure.sha)) return; // one reaction per head commit
  ci.shas = [...ci.shas, failure.sha].slice(-20);
  const max = ciFixAttempts();
  if (ci.attempts >= max) {
    store.update(taskId, { ci });
    postChecksFailedComment(userId, task, failure.sha, { kind: "gave-up", max });
    return;
  }
  const text = fixText(task, failure);
  const sent = await followUpTask(userId, task, text);
  if ("ok" in sent) {
    ci.attempts += 1;
    delete ci.pending;
    store.update(taskId, { ci });
    postChecksFailedComment(userId, task, failure.sha, { kind: "fixing", attempt: ci.attempts, max });
  } else {
    ci.pending = { sha: failure.sha, text };
    store.update(taskId, { ci });
    postChecksFailedComment(userId, task, failure.sha, { kind: "waiting" });
  }
}

/** A runner may be online now: send the fixes that were waiting for one. Fire-and-forget. */
export function retryPendingCiFixes(userId: string): void {
  const store = taskStores.for(userId);
  for (const task of store.list()) {
    const pending = task.ci?.pending;
    if (!pending || task.state !== "pr-open") continue;
    void followUpTask(userId, task, pending.text).then((sent) => {
      if (!("ok" in sent)) return;
      const current = store.get(task.id);
      if (!current?.ci) return;
      const ci: TaskCi = { ...current.ci, attempts: current.ci.attempts + 1 };
      delete ci.pending;
      store.update(task.id, { ci });
      postChecksFailedComment(userId, current, `${pending.sha}:retry`, { kind: "fixing", attempt: ci.attempts, max: ciFixAttempts() });
    }).catch(() => undefined);
  }
}
