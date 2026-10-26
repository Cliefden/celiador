import type { SessionEvent } from "../sessions/types";
import { taskStores } from "./dispatch";
import { publishTaskChange } from "./events";
import type { TaskAwaiting } from "./store";

/**
 * A task's live fields, derived from its linked relay session's events (the
 * editor run publishes them; see sessions/publish.ts):
 *
 * - `activity` — the latest activity line, kept in memory and published at most
 *   once per THROTTLE_MS per task (a streaming run emits many a second);
 * - `awaiting` — set by an approval / question, cleared once the session leaves
 *   `awaiting` (the decision was made here, on the desktop, or abandoned).
 */

const THROTTLE_MS = 2_000;
const MAX_ACTIVITY = 200;
const MAX_TEXT = 2_000;
const MAX_PREVIEW = 4_000;

const lastPublish = new Map<string, number>();
const pendingPublish = new Map<string, ReturnType<typeof setTimeout>>();

function publishNow(userId: string, taskId: string): void {
  const key = `${userId}:${taskId}`;
  const timer = pendingPublish.get(key);
  if (timer) clearTimeout(timer);
  pendingPublish.delete(key);
  lastPublish.set(key, Date.now());
  const task = taskStores.for(userId).get(taskId);
  if (task) publishTaskChange(userId, task);
}

function publishThrottled(userId: string, taskId: string): void {
  const key = `${userId}:${taskId}`;
  if (pendingPublish.has(key)) return;
  const wait = THROTTLE_MS - (Date.now() - (lastPublish.get(key) ?? 0));
  if (wait <= 0) return publishNow(userId, taskId);
  const timer = setTimeout(() => publishNow(userId, taskId), wait);
  timer.unref?.();
  pendingPublish.set(key, timer);
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Feed one published session event into the task linked to that session, if any. */
export function taskSessionEvent(userId: string, sessionId: string, event: SessionEvent): void {
  const store = taskStores.for(userId);
  const task = store.forSession(sessionId);
  // pr-open still counts: a follow-up turn runs on a task whose PR is open.
  if (!task || task.state === "merged" || task.state === "failed" || task.state === "cancelled") return;
  switch (event.kind) {
    case "activity": {
      const line = clip(event.text.replace(/\s+/g, " ").trim(), MAX_ACTIVITY);
      if (!line || task.activity === line) return;
      store.setActivity(task.id, line);
      publishThrottled(userId, task.id);
      return;
    }
    case "approval": {
      const text = event.title?.trim() || (event.path ? `${event.approvalKind}: ${event.path}` : event.approvalKind);
      const awaiting: TaskAwaiting = {
        kind: "permission",
        requestId: event.requestId,
        text: clip(text, MAX_TEXT),
        ...(event.preview ? { preview: clip(event.preview, MAX_PREVIEW) } : {}),
      };
      store.update(task.id, { awaiting });
      publishNow(userId, task.id);
      return;
    }
    case "question": {
      const awaiting: TaskAwaiting = {
        kind: "question",
        requestId: event.requestId,
        text: clip(event.prompt, MAX_TEXT),
        ...(event.choices?.length ? { choices: event.choices } : {}),
      };
      store.update(task.id, { awaiting });
      publishNow(userId, task.id);
      return;
    }
    case "state": {
      if (event.state === "awaiting" || event.state === "running") {
        if (event.state === "running" && task.awaiting) {
          store.update(task.id, { awaiting: undefined });
          publishNow(userId, task.id);
        }
        return;
      }
      // idle / done / error / cancelled: nothing is running or waiting any more.
      if (!task.awaiting && !task.activity) return;
      store.setActivity(task.id, undefined);
      store.update(task.id, { awaiting: undefined });
      publishNow(userId, task.id);
      return;
    }
    case "done":
    case "error": {
      if (!task.awaiting && !task.activity) return;
      store.setActivity(task.id, undefined);
      store.update(task.id, { awaiting: undefined });
      publishNow(userId, task.id);
      return;
    }
    default:
      return;
  }
}
