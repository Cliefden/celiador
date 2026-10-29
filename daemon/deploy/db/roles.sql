-- Runs once when a non-prod environment's Postgres volume is first initialised
-- (mounted into /docker-entrypoint-initdb.d by deploy/compose.yml). The
-- supabase/postgres image creates its service roles without a usable password;
-- give the ones that exist in this image version the environment's
-- POSTGRES_PASSWORD, as the self-hosted Supabase stack's roles.sql does for
-- prod. GoTrue connects as supabase_auth_admin; the others are unused here but
-- kept in step with prod.
\set pgpass `echo "$POSTGRES_PASSWORD"`
-- psql variables are not interpolated inside dollar quotes; hand the value to
-- the DO block through a session setting instead.
SELECT set_config('celiador.pgpass', :'pgpass', false);

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_functions_admin', 'supabase_storage_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER USER %I WITH PASSWORD %L', r, current_setting('celiador.pgpass'));
    END IF;
  END LOOP;
END
$$;
