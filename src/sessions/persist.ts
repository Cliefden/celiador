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

/** An assistant reply being streamed as `delta` events, not yet persisted. */
interface StreamedReply {
  seq: number;
  at: string;
  text: string;
}

/**
 * Per-session assistant text accumulated from `delta` events. Editor and
 * Celiador Remote runners stream replies only as deltas (no closing assistant
 * `message`), so without this their replies never reach durable history.
 */
const replies = new Map<string, StreamedReply>();

/**
 * Queue a durable write for this event. Never throws and never blocks the relay.
 * Activity / tool events are live-only. Deltas are buffered and written as one
 * assistant message when the reply ends (the next non-delta, non-activity
 * event). The chat row is upserted on the first event and on
 * state/message/done/error events.
 */
export function persistSession(userId: string, session: Session, event: SessionEvent): void {
  if (!getPool()) return;
  let reply: StreamedReply | undefined;
  if (event.kind === "delta") {
    const r = replies.get(session.id);
    if (r) r.text += event.text;
    else replies.set(session.id, { seq: event.seq, at: event.at, text: event.text });
  } else if (event.kind !== "activity") {
    reply = replies.get(session.id);
    replies.delete(session.id);
    // A runner that sends its own closing assistant message is authoritative.
    if (event.kind === "message" && event.role === "assistant") reply = undefined;
  }
  const first = !chains.has(session.id);
  if (!first && !reply?.text && !CHAT_ROW_KINDS.has(event.kind)) return;
  // Snapshot what we write now; the session object keeps mutating.
  const snapshot = { title: session.title, state: session.state, origin: session.origin };
  const prev = chains.get(session.id) ?? Promise.resolve();
  const next = prev.then(() => write(userId, session.id, snapshot, event, reply));
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
  event: SessionEvent,
  reply?: StreamedReply
): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    // Keep the chat row in step with the session. The conflict update is scoped
    // to the owner, so an id collision can never rewrite another user's chat.
    await pool.query(
      `insert into public.chats (id, user_id, title, session_id, origin, status, created_at, updated_at)
       values ($1, $2, $3, $6, $4, $5, now(), now())
       on conflict (id) do update
         set title = excluded.title, status = excluded.status, updated_at = now()
         where public.chats.user_id = excluded.user_id`,
      // The id goes in twice ($1 uuid, $6 text): one parameter used for both
      // columns fails with "inconsistent types deduced for parameter $1".
      [sessionId, userId, snap.title, chatOrigin(snap.origin), snap.state, sessionId]
    );

    // Only conversation turns become durable messages: explicit `message` events
    // and streamed replies (keyed by their first delta's seq). Other event kinds
    // (activity/tool/diff/…) are live-only relay concerns.
    if (reply?.text) {
      await insertMessage(userId, sessionId, "assistant", reply.text, reply.seq, reply.at);
    }
    if (event.kind === "message") {
      await insertMessage(userId, sessionId, event.role, event.text, event.seq, event.at);
    }
  } catch (err) {
    console.error("[persist] session write failed:", err instanceof Error ? err.message : err);
  }
}

async function insertMessage(
  userId: string,
  sessionId: string,
  role: "user" | "assistant",
  text: string,
  seq: number,
  at: string
): Promise<void> {
  await getPool()!.query(
    `insert into public.messages (chat_id, user_id, role, content, seq, created_at)
     select $1, $2, $3, $4::jsonb, $5, $6
     where exists (select 1 from public.chats where id = $1 and user_id = $2)
     on conflict (chat_id, seq) where seq is not null do nothing`,
    [sessionId, userId, role, JSON.stringify({ text }), seq, at]
  );
}

/** Relay origin → chats.origin domain ('editor' | 'ios' | 'server'). */
function chatOrigin(origin: SessionOrigin): string {
  return origin === "phone" ? "ios" : "editor";
}
