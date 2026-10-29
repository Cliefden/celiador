import { sessionBus } from "../sessions/bus";
import { sessionStores } from "../sessions/instance";
import { publishSessionEvent } from "../sessions/publish";
import { cloudFollowUp } from "./cloud";
import type { Task } from "./store";

/**
 * Send a run back with more instructions — the queue's "Send back…" and the
 * checks-failed auto-fix share this. An editor run gets an `instruct` on its
 * session (logged as the user's turn first, like the session message route); a
 * cloud run gets another sandbox turn in its retained workspace. The error text
 * is what the HTTP route answers with.
 */
export async function followUpTask(userId: string, task: Task, text: string): Promise<{ ok: true } | { error: string; status: 409 | 503 }> {
  if (task.state === "merged" || task.state === "cancelled") return { error: `the task is ${task.state}`, status: 409 };
  const session = task.sessionId ? sessionStores.for(userId).get(task.sessionId) : undefined;
  if (!session) return { error: "the task has no session yet", status: 409 };
  const trimmed = text.trim();
  if (session.runner === "server") return cloudFollowUp(userId, task.id, trimmed);
  if (!sessionBus.hasRunner(session.id)) return { error: "editor offline", status: 409 };
  publishSessionEvent(userId, session.id, { kind: "message", role: "user", text: trimmed });
  sessionBus.sendCommand(session.id, { kind: "instruct", text: trimmed });
  return { ok: true };
}
