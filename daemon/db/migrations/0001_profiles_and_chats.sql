-- 0001_profiles_and_chats.sql
-- Celiador Supabase app-data schema: profiles + durable chat history.
--
-- Context: the celiador-db `public` schema is currently EMPTY — Supabase is used
-- for auth/identity only. This adds the first durable app data. It does NOT
-- replace the daemon's live agent-session relay (data/sessions ring buffer):
--   • daemon relay  = LIVE, ephemeral runner↔watcher streaming
--   • these tables  = DURABLE profiles + persisted transcripts + cross-device history
--
-- Writers: the daemon (service-role key) persists chats/messages — it's already in
-- the event path. Clients may READ their own rows directly via PostgREST under RLS.
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth.users, created on signup
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  plan         text not null default 'free',      -- 'free' | 'pro' | 'team'
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- Inserts happen via the signup trigger below (security definer); no client insert.

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'full_name',
             split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any users who already exist.
insert into public.profiles (id, email, display_name)
select u.id, u.email, split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- chats — one agent conversation / session transcript
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.chats (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text,
  session_id      text,                              -- links to a live relay session, if any
  origin          text not null default 'editor',    -- 'editor' | 'ios' | 'server'
  workspace       text,                              -- optional: repo / workspace label
  status          text not null default 'active',    -- 'active' | 'done' | 'error'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz
);

create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);
create index if not exists chats_session_idx on public.chats (session_id);

alter table public.chats enable row level security;

drop policy if exists "chats_all_own" on public.chats;
create policy "chats_all_own" on public.chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists chats_set_updated_at on public.chats;
create trigger chats_set_updated_at
  before update on public.chats
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- messages — turns within a chat (user_id denormalized so RLS needs no join)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null,                    -- 'user' | 'assistant' | 'tool' | 'system'
  content    jsonb not null,                   -- text and/or structured blocks / tool calls
  seq        bigint,                           -- monotonic within a chat (mirrors relay event id)
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_created_idx on public.messages (chat_id, created_at);
create unique index if not exists messages_chat_seq_idx on public.messages (chat_id, seq) where seq is not null;

alter table public.messages enable row level security;

drop policy if exists "messages_all_own" on public.messages;
create policy "messages_all_own" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep chats.last_message_at / updated_at fresh as messages arrive.
create or replace function public.bump_chat_on_message()
returns trigger language plpgsql as $$
begin
  update public.chats
     set last_message_at = new.created_at, updated_at = now()
   where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_chat on public.messages;
create trigger messages_bump_chat
  after insert on public.messages
  for each row execute function public.bump_chat_on_message();

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional (NOT enabled here): Supabase Realtime for messages, so a client could
-- subscribe directly. The iOS companion uses the daemon relay for live streaming,
-- so this stays off by default. To enable later:
--   alter publication supabase_realtime add table public.messages;
-- ─────────────────────────────────────────────────────────────────────────────
