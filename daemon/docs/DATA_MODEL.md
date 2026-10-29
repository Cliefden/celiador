# Celiador data model — profiles & chat history (draft)

Status: **proposal / not yet wired.** Migration lives at
`db/migrations/0001_profiles_and_chats.sql`. This doc explains what it is, why it's
shaped this way, and what's needed to turn it on.

## Where things stand

The self-hosted Supabase (`celiador-db` on the box) is currently **auth-only** — the
`public` schema is empty; the only data is `auth.users` (~3 users). The daemon
verifies the GoTrue JWT and keeps all state on the filesystem. See the
`celiador-supabase-usage` note.

We now want durable **profiles** and **saved chat history** (so past agent
conversations persist and sync across the editor and the iOS companion).

## Two layers, not one — this is the key idea

Chat data has a *live* form and a *durable* form, and they use different transports:

| | Live (in-flight) | Durable (history) |
|---|---|---|
| Transport | **Daemon session relay** (`src/sessions/`, in-process bus + `data/sessions/` ring buffer) | **Supabase Postgres** (`chats`, `messages`) |
| Shape | SSE, Last-Event-ID replay, ephemeral | Rows, queryable, cross-device |
| Who | editor = runner, phone = watcher | anyone who signs in later |

Supabase does **not** replace the relay (that decision is locked for the iOS
companion). It sits underneath it: as a session runs, the daemon — already in the
event path via `POST /api/sessions/:id/events` — **flushes turns into `messages`**.
When the app reopens, history comes from Supabase; the live tail comes from the relay.

So: **relay = now, Supabase = memory.**

## Schema (see the migration for full DDL)

- **`profiles`** — `id → auth.users.id`, `email`, `display_name`, `avatar_url`,
  `plan` (`free|pro|team`), `settings jsonb`. Auto-created by an `on_auth_user_created`
  trigger; existing users backfilled. Users can read/update only their own row (RLS).
- **`chats`** — `id`, `user_id`, `title`, `session_id` (links to a live relay session
  if one exists), `origin` (`editor|ios|server`), `workspace`, `status`, timestamps,
  `last_message_at`.
- **`messages`** — `id`, `chat_id`, `user_id` (denormalized for cheap RLS), `role`
  (`user|assistant|tool|system`), `content jsonb` (text or structured blocks/tool
  calls), `seq` (monotonic per chat, mirrors the relay event id), `created_at`.

`seq` deliberately mirrors the relay's event id so a persisted transcript and a live
replay line up — the phone can page history by `seq`, then subscribe to the relay
from the last `seq` it has.

## Access model — who reads, who writes

- **Writes: the daemon**, using the Supabase **service-role key** (bypasses RLS).
  It's the single writer because it already receives runner events. Clients never
  write chat rows directly.
- **Reads: either path.** Clients (editor/iOS) can read their own history directly
  via **PostgREST + RLS** (`user_id = auth.uid()`), or through a daemon endpoint —
  both are fine because RLS enforces per-user scoping regardless.
- **Profiles**: created by trigger; the owner updates via RLS. Reads via PostgREST.

RLS is on for all three tables (`auth.uid() = user_id`, profiles keyed on `id`).

## What's needed to turn it on (not done yet)

1. **Apply the migration** to `celiador-db` (see below).
2. **Give the daemon DB access** — add `SUPABASE_SERVICE_ROLE_KEY` (and either a
   Postgres connection string for a `pg` client, or use PostgREST via the service
   key) to `~/daemon/.env`. Recommendation: a direct `pg` client in the daemon for
   transactional writes; keep reads client-side via PostgREST.
3. **Persist from the relay** — in `src/sessions/`, on each runner event (or on
   session end), upsert the `chat` and append `messages`. New module, e.g.
   `src/db/` (pg pool) + a `persistChat`/`appendMessage` helper.
4. **Client history UI** — editor + iOS list past chats (PostgREST query) and open
   one, then attach to the live relay if `status = active`.

## Applying the migration

Self-hosted, via the DB container (read/write — needs prod-DB approval):

```sh
# copy the file up, then:
ssh stefan@cliefden.com 'sudo docker exec -i celiador-db psql -U postgres -d postgres' < db/migrations/0001_profiles_and_chats.sql
```

Or, if the Supabase CLI is wired to this project, `supabase db push`.

## Open questions

- **Message granularity** — one row per turn, or per content block? (Draft: per
  turn, `content` holds the blocks.) Affects how the relay flushes.
- **Retention** — keep all chats forever, or prune/archive? (`plan`-dependent?)
- **Tool calls / approvals** — store as `messages` rows (`role='tool'`) or a side
  table? (Draft: as messages; revisit if the companion needs to query them.)
- **Realtime** — left OFF (relay covers live). Enable
  `supabase_realtime add table public.messages` only if a client wants to skip the
  relay.
