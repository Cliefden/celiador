import { getPool } from "../db/pool";
import type { Session, SessionEvent, SessionOrigin } from "./types";

/**
 * Durable mirror of the session relay into Supabase (chats + messages).
 *
 * The relay's on-disk ring buffer is bounded and reaped (7d / 200 sessions); this
 * gives chats a permanent, queryable home so history survives and syncs across
 * devices. Best-effort: a no-op when the DB isn't configured, and never throws
 * into the relay's hot path (errors are logged, swallowed).
 *
 * A chat row IS the session (chats.id = session.id), so messages.seq (monotonic
 * per session) maps cleanly onto the (chat_id, seq) uniqueness in the schema.
 */
/**
 * Per-session write chains: writes for one session run strictly in order, so a
 * slow upsert can't land after a newer one and leave `status` stale.
 */
const chains = new Map<string, Promise<void>>();

/** Event kinds that change what the chat row shows (title/status/recency). */
const CHAT_ROW_KINDS = new Set(["state", "message", "done", "error"]);

/**
 * Queue a durable write for this event. Never throws and never blocks the relay.
 * Streamed deltas / activity / tool events are live-only, so they cause no DB
 * write at all; the chat row is upserted on the first event and on
 * state/message/done/error events.
 */
export function persistSession(userId: string, session: Session, event: SessionEvent): void {
  if (!getPool()) return;
  const first = !chains.has(session.id);
  if (!first && !CHAT_ROW_KINDS.has(event.kind)) return;
  // Snapshot what we write now; the session object keeps mutating.
  const snapshot = { title: session.title, state: session.state, origin: session.origin };
  const prev = chains.get(session.id) ?? Promise.resolve();
  const next = prev.then(() => write(userId, session.id, snapshot, event));
  chains.set(session.id, next);
  // Drop the chain entry once idle so the map doesn't grow without bound.
  void next.then(() => {
    if (chains.get(session.id) === next && (event.kind === "done" || (event.kind === "state" && event.state !== "running" && event.state !== "awaiting"))) {
      chains.delete(session.id);
    }
  });
}

async function write(
  userId: string,
  sessionId: string,
  snap: { title: string; state: Session["state"]; origin: SessionOrigin },
  event: SessionEvent
): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    // Keep the chat row in step with the session. The conflict update is scoped
    // to the owner, so an id collision can never rewrite another user's chat.
    await pool.query(
      `insert into public.chats (id, user_id, title, session_id, origin, status, created_at, updated_at)
       values ($1, $2, $3, $1, $4, $5, now(), now())
       on conflict (id) do update
         set title = excluded.title, status = excluded.status, updated_at = now()
         where public.chats.user_id = excluded.user_id`,
      [sessionId, userId, snap.title, chatOrigin(snap.origin), snap.state]
    );

    // Only conversation turns become durable messages. Other event kinds
    // (delta/activity/tool/diff/…) are live-only relay concerns.
    if (event.kind === "message") {
      await pool.query(
        `insert into public.messages (chat_id, user_id, role, content, seq, created_at)
         select $1, $2, $3, $4::jsonb, $5, $6
         where exists (select 1 from public.chats where id = $1 and user_id = $2)
         on conflict (chat_id, seq) where seq is not null do nothing`,
        [sessionId, userId, event.role, JSON.stringify({ text: event.text }), event.seq, event.at]
      );
    }
  } catch (err) {
    console.error("[persist] session write failed:", err instanceof Error ? err.message : err);
  }
}

/** Relay origin → chats.origin domain ('editor' | 'ios' | 'server'). */
function chatOrigin(origin: SessionOrigin): string {
  return origin === "phone" ? "ios" : "editor";
}
