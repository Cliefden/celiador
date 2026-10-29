-- Runs once, after the image's own migrations, when a non-prod environment's
-- Postgres volume is first initialised (mounted into
-- /docker-entrypoint-initdb.d/migrations by deploy/compose.yml).
--
-- The supabase/postgres image creates auth.uid(), auth.role() and friends as
-- supabase_admin. GoTrue's first migration (00_init_auth_schema) does
-- `create or replace function auth.uid()` as supabase_auth_admin and fails with
-- "must be owner of function uid" (seen on 15.8.1.085 + gotrue v2.186.0,
-- 2026-10-28). Hand every function in the auth schema to the role GoTrue
-- connects as, so its migrations can run.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'auth'::regnamespace
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', f.sig);
  END LOOP;
END
$$;
