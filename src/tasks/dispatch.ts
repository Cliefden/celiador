import { ROOT } from "../config";
import { editorControl } from "../presence/control";
import { workspacePresence } from "../presence/workspaces";
import { publishTaskChange } from "./events";
import { ACTIVE_STATES, repoKey, TaskStores, type Task } from "./store";

/** Process-wide task stores (shared by the webhook, the routes and account deletion). */
export const taskStores = new TaskStores(ROOT);

/** Parallel runs per user. Published like the agent limits; 0 = no limit. */
export function taskConcurrency(): number {
  const n = Number(process.env.CELIADOR_TASK_CONCURRENCY ?? 3);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

/**
 * Hand queued tasks to the user's editor, oldest first, while parallel slots
 * are free and an editor that has the task's repo open is online. Called when a
 * task is created, when one finishes, and when an editor heartbeats or connects.
 * A task whose repo no online editor has stays queued — cloud runs pick those
 * up once the sandbox can open pull requests (daemon#11).
 */
export function dispatchTasks(userId: string): Task[] {
  const store = taskStores.for(userId);
  const all = store.list();
  const limit = taskConcurrency();
  let active = all.filter((t) => ACTIVE_STATES.has(t.state)).length;
  if (editorControl.count(userId) === 0) return [];
  const open = new Map(workspacePresence.list(userId).map((w) => [repoKey(w.remoteUrl), w]));
  const sent: Task[] = [];
  for (const task of store.queued()) {
    if (limit > 0 && active >= limit) break;
    const ws = open.get(repoKey(task.repo.url));
    if (!ws) continue;
    const delivered = editorControl.request(userId, {
      kind: "start-task",
      taskId: task.id,
      remoteUrl: ws.remoteUrl,
      name: ws.name,
      branch: task.branch,
      prompt: task.prompt,
      title: task.title,
      issue: task.issue ? { number: task.issue.number, url: task.issue.url } : undefined,
    });
    if (delivered === 0) break;
    store.update(task.id, { state: "dispatched" });
    publishTaskChange(userId, task);
    sent.push(task);
    active++;
  }
  return sent;
}
