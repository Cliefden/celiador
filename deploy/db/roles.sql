-- Runs once when a non-prod environment's Postgres volume is first initialised
-- (mounted into /docker-entrypoint-initdb.d by deploy/compose.yml). The
-- supabase/postgres image creates these service roles without a usable
-- password; give them the environment's POSTGRES_PASSWORD, as the self-hosted
-- Supabase stack's roles.sql does for prod. GoTrue connects as
-- supabase_auth_admin; the others are unused here but kept in step with prod.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
