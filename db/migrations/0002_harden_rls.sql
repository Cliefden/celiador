-- 0002_harden_rls.sql
-- Tighten 0001's client-facing RLS (audit 2026-09-26, finding L5). Idempotent.
--
--  1. profiles: a user may update their own row via PostgREST, but NOT their
--     `plan` (the anon key is public via GET /api/config, so the old policy let
--     anyone self-upgrade). Plan changes are service-side only (daemon / SQL).
--  2. messages: the insert/update check now also requires that `chat_id` belongs
--     to the caller, not just that `user_id` = auth.uid().
--
-- The daemon connects as a trusted role that bypasses RLS and never writes
-- `plan`, so it is unaffected.

-- ── 1. profiles.plan is not client-writable ─────────────────────────────────

create or replace function public.profiles_guard_privileged()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only end-user sessions are restricted; service roles / direct SQL pass.
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'authenticated' then
    if new.plan is distinct from old.plan then
      raise exception 'plan cannot be changed by the client' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'id cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged();

-- ── 2. messages must belong to one of the caller's chats ─────────────────────

drop policy if exists "messages_all_own" on public.messages;
create policy "messages_all_own" on public.messages
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid())
  );
