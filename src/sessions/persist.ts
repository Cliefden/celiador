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
export async function persistSession(
  userId: string,
  session: Session,
  event: SessionEvent
): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    // Keep the chat row in step with the session on every event (cheap upsert).
    await pool.query(
      `insert into public.chats (id, user_id, title, session_id, origin, status, created_at, updated_at)
       values ($1, $2, $3, $1, $4, $5, now(), now())
       on conflict (id) do update
         set title = excluded.title, status = excluded.status, updated_at = now()`,
      [session.id, userId, session.title, chatOrigin(session.origin), session.state]
    );

    // Only conversation turns become durable messages. Other event kinds
    // (delta/activity/tool/diff/…) are live-only relay concerns.
    if (event.kind === "message") {
      await pool.query(
        `insert into public.messages (chat_id, user_id, role, content, seq, created_at)
         values ($1, $2, $3, $4::jsonb, $5, $6)
         on conflict (chat_id, seq) where seq is not null do nothing`,
        [session.id, userId, event.role, JSON.stringify({ text: event.text }), event.seq, event.at]
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
