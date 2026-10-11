import { sessionStores } from "./instance";
import { sessionBus } from "./bus";
import { notifySession } from "./notify";
import { persistSession } from "./persist";
import type { SessionEvent, SessionEventInput } from "./types";

/**
 * Append a runner-published event to a session, fan it out to watchers, push to
 * APNs, and mirror it to Supabase — all best-effort. Shared by the relay routes
 * (events posted over HTTP by a client runner) and the in-process server runner
 * (src/runner), so both reach watchers/push/persistence identically.
 */
export function publishSessionEvent(userId: string, sessionId: string, input: SessionEventInput): SessionEvent | undefined {
  const store = sessionStores.for(userId);
  const event = store.append(sessionId, input);
  if (event) {
    sessionBus.publishEvent(sessionId, event);
    const session = store.get(sessionId);
    if (session) {
      notifySession(userId, session, event).catch((err) =>
        console.error("[notify] push failed:", err instanceof Error ? err.message : err)
      );
      persistSession(userId, session, event); // durable mirror → Supabase (no-op if unconfigured; serialized, never throws)
    }
  }
  return event;
}
