import { ROOT } from "../config";
import { githubApp } from "../github/app";
import { editorControl } from "../presence/control";
import { workspacePresence } from "../presence/workspaces";
import { retryPendingCiFixes } from "./ci";
import { cloudEligible, recoverOrphanedCloudTasks, startCloudRun } from "./cloud";
import { postFailedComment } from "./comments";
import { publishTaskChange } from "./events";
import { ACTIVE_STATES, repoKey, TaskStores, type Task, type TaskStore } from "./store";

/** Process-wide task stores (shared by the webhook, the routes and account deletion). */
export const taskStores = new TaskStores(ROOT);

/** Parallel runs per user. Published like the agent limits; 0 = no limit. */
export function taskConcurrency(): number {
  const n = Number(process.env.CELIADOR_TASK_CONCURRENCY ?? 3);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/** A Mac that got a task but hasn't reported `running` this long after didn't start it. */
export const DISPATCH_GRACE_MS = 90_000;
/** Silent hand-offs before the task fails instead of being offered to the Mac again. */
export const MAX_SILENT_DISPATCHES = 2;

/**
 * Tasks a Mac was handed but never started: back to the queue, and after
 * {@link MAX_SILENT_DISPATCHES} silent hand-offs failed with the likely cause.
 * An editor too old to know `start-task` ignores the command (presence/control.ts),
 * and nothing else would ever move the task — the phone showed "starting on your
 * Mac" indefinitely. Runs on every dispatch, so an editor's heartbeat is the clock.
 */
function reclaimSilentDispatches(userId: string, store: TaskStore, now = Date.now()): void {
  for (const task of store.list()) {
    if (task.state !== "dispatched" || task.runner !== "mac" || !task.dispatchedAt) continue;
    if (now - Date.parse(task.dispatchedAt) < DISPATCH_GRACE_MS) continue;
    const silent = task.dispatches ?? 1;
    const updated =
      silent >= MAX_SILENT_DISPATCHES
        ? store.update(task.id, {
            state: "failed",
            error: "your Mac got the task but never started it — update Celiador on the Mac that has this repo open, then queue it again",
          })
        : store.update(task.id, { state: "queued", runner: undefined, error: "your Mac got the task but didn't start it; trying again" });
    if (!updated) continue;
    publishTaskChange(userId, updated);
    if (updated.state === "failed") postFailedComment(userId, updated);
  }
}

/**
 * Hand queued tasks to a runner, oldest first, while parallel slots are free:
 * to the user's editor when one online has the task's repo open; otherwise to
 * the cloud (tasks/cloud.ts) when the sandboxed runner is on — the laptop-off
 * case. A task that neither can take stays queued. Called when a task is
 * created, when one finishes, and when an editor heartbeats or connects; the
 * same moments are when a checks-failed fix that waited for a runner is retried.
 */
export function dispatchTasks(userId: string): Task[] {
  const store = taskStores.for(userId);
  recoverOrphanedCloudTasks(userId, store);
  reclaimSilentDispatches(userId, store);
  const all = store.list();
  const limit = taskConcurrency();
  let active = all.filter((t) => ACTIVE_STATES.has(t.state)).length;
  const editors = editorControl.count(userId);
  const open = new Map(editors > 0 ? workspacePresence.list(userId).map((w) => [repoKey(w.remoteUrl), w]) : []);
  const sent: Task[] = [];
  for (const task of store.queued()) {
    if (limit > 0 && active >= limit) break;
    const ws = open.get(repoKey(task.repo.url));
    if (ws) {
      // With the GitHub App set up, the daemon itself posts the "picked up"
      // comment as Celiador — when the editor reports `running` (tasks/pulls.ts),
      // so it can name the machine; the editor then skips its own (gh-token) comment.
      const commented = !!githubApp() && !!task.issue;
      const delivered = editorControl.request(userId, {
        kind: "start-task",
        taskId: task.id,
        remoteUrl: ws.remoteUrl,
        name: ws.name,
        branch: task.branch,
        prompt: task.prompt,
        title: task.title,
        issue: task.issue ? { number: task.issue.number, url: task.issue.url } : undefined,
        commented,
      });
      if (delivered === 0) break;
      store.update(task.id, {
        state: "dispatched",
        runner: "mac",
        error: undefined,
        dispatchedAt: new Date().toISOString(),
        dispatches: (task.dispatches ?? 0) + 1,
      });
    } else if (cloudEligible(task)) {
      // Marked synchronously so a second dispatch can't start it twice; the
      // network checks (sandbox, App on the repo) happen in startCloudRun, which
      // re-queues the task with the reason when one fails.
      store.update(task.id, { state: "dispatched", runner: "cloud" });
      void startCloudRun(userId, task.id);
    } else continue;
    publishTaskChange(userId, task);
    sent.push(task);
    active++;
  }
  retryPendingCiFixes(userId);
  return sent;
}
