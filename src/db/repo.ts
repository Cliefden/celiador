import { getPool } from "./pool";

/**
 * Data-access for profiles + chat history, exposed to clients (editor + iOS)
 * THROUGH the daemon — clients never touch Postgres/PostgREST directly.
 *
 * The daemon connects as a trusted role that bypasses RLS, so **every query here
 * MUST filter by the caller's userId**. That per-user scoping is the security
 * boundary for daemon-mediated access (RLS remains defense-in-depth for any
 * direct PostgREST path). All functions return null / [] when the DB is off.
 */

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  plan: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  title: string | null;
  origin: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface MessageRow {
  id: string;
  role: string;
  content: unknown;
  seq: number | null;
  created_at: string;
}

const PROFILE_COLS = "id, email, display_name, avatar_url, plan, settings, created_at, updated_at";
const CHAT_COLS = "id, title, origin, status, created_at, updated_at, last_message_at";

// ── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query<Profile>(
    `select ${PROFILE_COLS} from public.profiles where id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function updateProfile(
  userId: string,
  patch: { display_name?: string; avatar_url?: string; settings?: Record<string, unknown> }
): Promise<Profile | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query<Profile>(
    `update public.profiles set
       display_name = coalesce($2, display_name),
       avatar_url   = coalesce($3, avatar_url),
       settings     = case when $4::jsonb is null then settings else settings || $4::jsonb end,
       updated_at   = now()
     where id = $1
     returning ${PROFILE_COLS}`,
    [
      userId,
      patch.display_name ?? null,
      patch.avatar_url ?? null,
      patch.settings !== undefined ? JSON.stringify(patch.settings) : null,
    ]
  );
  return rows[0] ?? null;
}

// ── Chats & messages ─────────────────────────────────────────────────────────

export async function listChats(userId: string, limit = 100): Promise<ChatRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query<ChatRow>(
    `select ${CHAT_COLS} from public.chats
     where user_id = $1 order by updated_at desc limit $2`,
    [userId, Math.min(Math.max(limit, 1), 500)]
  );
  return rows;
}

export async function getChat(
  userId: string,
  chatId: string
): Promise<{ chat: ChatRow; messages: MessageRow[] } | null> {
  const pool = getPool();
  if (!pool) return null;
  const chat = await pool.query<ChatRow>(
    `select ${CHAT_COLS} from public.chats where id = $1 and user_id = $2`,
    [chatId, userId]
  );
  if (chat.rows.length === 0) return null;
  const messages = await pool.query<MessageRow>(
    `select id, role, content, seq, created_at from public.messages
     where chat_id = $1 and user_id = $2 order by seq asc nulls last, created_at asc`,
    [chatId, userId]
  );
  return { chat: chat.rows[0]!, messages: messages.rows };
}

export async function renameChat(userId: string, chatId: string, title: string): Promise<ChatRow | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query<ChatRow>(
    `update public.chats set title = $3, updated_at = now()
     where id = $1 and user_id = $2 returning ${CHAT_COLS}`,
    [chatId, userId, title]
  );
  return rows[0] ?? null;
}

export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const { rowCount } = await pool.query(
    `delete from public.chats where id = $1 and user_id = $2`,
    [chatId, userId]
  );
  return (rowCount ?? 0) > 0;
}
