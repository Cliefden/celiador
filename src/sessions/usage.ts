import type { AuthResult } from "../auth";
import { taskSessionUsage } from "../tasks/live";
import { sessionStores } from "./instance";
import type { Session } from "./types";

/** The header the editor's daemon proxy sets on every gateway request of a session: its agent-host session URI, the relay's `mirrorKey`. */
export const MIRROR_HEADER = "x-celiador-mirror";

/**
 * Attribute one gateway request's tokens to the relay session it belongs to, so
 * a run has a cost (Session.usage → Task.usage → the PR body's footer):
 *
 * - a cloud run's runner token carries the run id (= the session id);
 * - an editor run sends `X-Celiador-Mirror: <agent-host session URI>`, the same
 *   value the relay bridge used as `mirrorKey` when it created the session.
 *
 * Missing or unknown → nothing here; the per-user quota (agent/quota.ts) has
 * already counted it. Never throws: accounting must not fail a stream.
 */
export function attributeUsage(user: AuthResult | null, mirrorKey: string | undefined, inputTokens: number, outputTokens: number): Session | undefined {
  if (!user) return undefined;
  try {
    const store = sessionStores.for(user.userId);
    const session = user.runId ? store.get(user.runId) : mirrorKey ? store.findMirror(mirrorKey.slice(0, 500)) : undefined;
    if (!session) return undefined;
    const usage = store.recordUsage(session.id, inputTokens, outputTokens);
    if (usage) taskSessionUsage(user.userId, session.id, usage);
    return session;
  } catch (err) {
    console.error("[usage] attribution failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
