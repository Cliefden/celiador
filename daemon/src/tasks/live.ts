import type { SessionEvent, SessionUsage } from "../sessions/types";
import { postAwaitingComment, postPlanComment } from "./comments";
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
 *   `awaiting` (the decision was made here, on the desktop, or abandoned);
 * - `usage` — the session's cost, copied onto the task as it grows (throttled
 *   publish; see sessions/usage.ts for the attribution).
 *
 * The same events feed the issue's narration (comments.ts): the agent's first
 * "Plan:" message, and each question / approval the run stops on.
 */

const THROTTLE_MS = 2_000;
const MAX_ACTIVITY = 200;
const MAX_TEXT = 2_000;
const MAX_PREVIEW = 4_000;
/** How much of a streamed reply is kept while looking for the plan (the plan is at the top). */
const MAX_REPLY_BUFFER = 20_000;

const lastPublish = new Map<string, number>();
const pendingPublish = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * Streamed assistant replies (`delta` events) per task, assembled until the reply
 * ends, so the plan can be read from runners that never send a closing
 * assistant `message` (the editor streams deltas only).
 */
const replies = new Map<string, string>();

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

/** The session spent more: mirror its usage onto the task (persisted) and publish, throttled. */
export function taskSessionUsage(userId: string, sessionId: string, usage: SessionUsage): void {
  const store = taskStores.for(userId);
  const task = store.forSession(sessionId);
  if (!task) return;
  store.update(task.id, { usage: { ...usage } });
  publishThrottled(userId, task.id);
}

/** Feed one published session event into the task linked to that session, if any. */
export function taskSessionEvent(userId: string, sessionId: string, event: SessionEvent): void {
  const store = taskStores.for(userId);
  const task = store.forSession(sessionId);
  // pr-open still counts: a follow-up turn runs on a task whose PR is open.
  if (!task || task.state === "merged" || task.state === "failed" || task.state === "cancelled") return;
  // A streamed reply ends at the first event that isn't part of it; that's when it is read as one message.
  if (event.kind !== "delta" && event.kind !== "activity") {
    const streamed = replies.get(task.id);
    if (streamed !== undefined) {
      replies.delete(task.id);
      if (!(event.kind === "message" && event.role === "assistant")) postPlanComment(userId, task, streamed);
    }
  }
  switch (event.kind) {
    case "activity": {
      const line = clip(event.text.replace(/\s+/g, " ").trim(), MAX_ACTIVITY);
      if (!line || task.activity === line) return;
      store.setActivity(task.id, line);
      publishThrottled(userId, task.id);
      return;
    }
    case "delta": {
      if (task.posted?.plan) return; // only the plan is read from replies
      const sofar = replies.get(task.id) ?? "";
      if (sofar.length < MAX_REPLY_BUFFER) replies.set(task.id, sofar + event.text);
      return;
    }
    case "message": {
      if (event.role === "assistant") postPlanComment(userId, task, event.text);
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
      const updated = store.update(task.id, { awaiting });
      publishNow(userId, task.id);
      if (updated) postAwaitingComment(userId, updated);
      return;
    }
    case "question": {
      const awaiting: TaskAwaiting = {
        kind: "question",
        requestId: event.requestId,
        text: clip(event.prompt, MAX_TEXT),
        ...(event.choices?.length ? { choices: event.choices } : {}),
      };
      const updated = store.update(task.id, { awaiting });
      publishNow(userId, task.id);
      if (updated) postAwaitingComment(userId, updated);
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
