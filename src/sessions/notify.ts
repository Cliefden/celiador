import { pushStores } from "../push/instance";
import { apnsAvailable, isDeadToken, sendAlert, sendLiveActivity } from "../push/apns";
import type { PushStore } from "../push/store";
import type { Session, SessionEvent, SessionState } from "./types";

/**
 * Turn session events into APNs so the phone gets told while the app is
 * suspended: an alert when the run needs you or finishes, and Live Activity
 * updates as it works. Best-effort and a no-op when APNS_* isn't configured.
 */
export async function notifySession(userId: string, session: Session, event: SessionEvent): Promise<void> {
  if (!apnsAvailable()) return;
  const push = pushStores.for(userId);
  switch (event.kind) {
    case "approval":
      await alertDevices(push, "Celiador needs you", `Approve a write to ${event.path ?? "a file"}`, session.id);
      break;
    case "question":
      await alertDevices(push, "Celiador has a question", event.prompt ?? "Tap to answer.", session.id);
      break;
    case "activity":
      await updateActivities(push, session, event.text ?? "");
      break;
    case "state":
      await onStateChange(push, session, event.state);
      break;
    default:
      break;
  }
}

async function onStateChange(push: PushStore, session: Session, state?: SessionState): Promise<void> {
  switch (state) {
    case "done":
      await alertDevices(push, "Task finished", session.title, session.id);
      await endActivities(push, session.id);
      break;
    case "error":
      await alertDevices(push, "Task failed", session.title, session.id);
      await endActivities(push, session.id);
      break;
    case "cancelled":
      await endActivities(push, session.id);
      break;
    case "running":
      await updateActivities(push, session, "");
      break;
    default:
      break;
  }
}

function labelFor(state: SessionState): string {
  switch (state) {
    case "running": return "working…";
    case "awaiting": return "needs you";
    case "done": return "done";
    case "error": return "failed";
    case "cancelled": return "cancelled";
    default: return "idle";
  }
}

async function alertDevices(push: PushStore, title: string, body: string, sessionId: string): Promise<void> {
  for (const d of push.devices()) {
    const result = await sendAlert({ token: d.token, env: d.env }, { title, body, data: { sessionId } });
    if (isDeadToken(result)) push.prune(d.token);
  }
}

async function updateActivities(push: PushStore, session: Session, line: string): Promise<void> {
  const contentState = { statusLabel: labelFor(session.state), activityText: line };
  for (const a of push.activitiesFor(session.id)) {
    const result = await sendLiveActivity({ token: a.token, env: a.env }, { event: "update", contentState });
    if (isDeadToken(result)) push.prune(a.token);
  }
}

async function endActivities(push: PushStore, sessionId: string): Promise<void> {
  const activities = push.activitiesFor(sessionId);
  for (const a of activities) {
    await sendLiveActivity(
      { token: a.token, env: a.env },
      { event: "end", contentState: { statusLabel: "done", activityText: "" }, dismissImmediately: true }
    );
  }
  if (activities.length) push.removeActivitiesFor(sessionId);
}
