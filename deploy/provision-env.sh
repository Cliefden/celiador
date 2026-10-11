#!/usr/bin/env bash
# Provision ONE non-prod environment (staging|dev) on the box, tailored to the
# real topology discovered on srv1680809:
#   - auth = lightweight standalone GoTrue per env (NOT a full Supabase stack),
#     attached to the existing `celiador_default` docker network, talking to the
#     existing Postgres (celiador-db, alias `db`) over a NEW database.
#   - daemon = a host systemd service `celiador-daemon@<env>` on its own port.
# PROD IS NOT TOUCHED. Run ON the box as `stefan`. Idempotent-ish (safe to re-run).
#
#   CELIADOR_ANTHROPIC_KEY=sk-ant-...  ./provision-env.sh staging
#   CELIADOR_ANTHROPIC_KEY=sk-ant-...  ./provision-env.sh dev
#
# You must supply CELIADOR_ANTHROPIC_KEY (the per-env "safe"/cheap key). All other
# secrets (JWT secret, DB role password) are generated here and written to files
# with 600 perms — never echoed.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  staging) DPORT=4672; GPORT=9997; HOSTN=staging.celiador.ai; MODEL=claude-opus-4-8 ;;
  dev)     DPORT=4673; GPORT=9996; HOSTN=dev.celiador.ai;     MODEL=claude-haiku-4-5 ;;
  *) echo "usage: CELIADOR_ANTHROPIC_KEY=... $0 <staging|dev>" >&2; exit 2 ;;
esac
: "${CELIADOR_ANTHROPIC_KEY:?set CELIADOR_ANTHROPIC_KEY to the per-env Anthropic key}"

NET=celiador_default
DBC=celiador-db            # prod Postgres container (shared cluster)
DBNAME="celiador_$ENV"
ROLE="auth_$ENV"
GIMG="supabase/gotrue:v2.186.0"   # match the prod celiador-auth image
ENVDIR="$HOME/envs/$ENV"
SECRETS="$ENVDIR/secrets"

echo "== [$ENV] 0. dirs + generated secrets =="
mkdir -p "$ENVDIR/daemon" "$ENVDIR/web" "$SECRETS"
chmod 700 "$SECRETS"
[ -f "$SECRETS/jwt" ]   || { openssl rand -hex 48 > "$SECRETS/jwt";   chmod 600 "$SECRETS/jwt"; }
[ -f "$SECRETS/dbpw" ] || { openssl rand -hex 24 > "$SECRETS/dbpw"; chmod 600 "$SECRETS/dbpw"; }
JWT="$(cat "$SECRETS/jwt")"
DBPW="$(cat "$SECRETS/dbpw")"

echo "== [$ENV] 1. database + role + extensions (shared celiador-db cluster) =="
if ! sudo docker exec "$DBC" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" | grep -q 1; then
  sudo docker exec "$DBC" psql -U postgres -c "CREATE DATABASE $DBNAME"
fi
# Create-or-update the login role, then make it own the DB so GoTrue can create
# its own `auth` schema. Password is reset to the generated value every run.
sudo docker exec "$DBC" psql -U postgres -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='$ROLE') THEN CREATE ROLE $ROLE LOGIN; END IF; END \$\$;"
sudo docker exec "$DBC" psql -U postgres -c "ALTER ROLE $ROLE LOGIN PASSWORD '$DBPW'"
sudo docker exec "$DBC" psql -U postgres -c "ALTER DATABASE $DBNAME OWNER TO $ROLE"
# GoTrue needs pgcrypto (crypt()) + uuid-ossp; create as superuser in the new DB.
sudo docker exec "$DBC" psql -U postgres -d "$DBNAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

echo "== [$ENV] 2. standalone GoTrue on :$GPORT (loopback) =="
sudo docker rm -f "gotrue-$ENV" >/dev/null 2>&1 || true
sudo docker run -d --name "gotrue-$ENV" --restart unless-stopped \
  --network "$NET" -p "127.0.0.1:$GPORT:9999" \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL="https://$HOSTN" -e GOTRUE_SITE_URL="https://$HOSTN" \
  -e GOTRUE_URI_ALLOW_LIST="celiador-$ENV://*,celiador://*" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://$ROLE:$DBPW@db:5432/$DBNAME?search_path=auth" \
  -e GOTRUE_JWT_SECRET="$JWT" -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_MAILER_AUTOCONFIRM=true \
  "$GIMG"

echo "== [$ENV] 3. daemon code + .env + systemd =="
rsync -a --delete --exclude node_modules --exclude data --exclude '.env' --exclude '.git' \
  "$HOME/daemon/" "$ENVDIR/daemon/"
( cd "$ENVDIR/daemon" && npm ci --omit=dev )
# Daemon .env — auth boundary via the per-env JWT secret. DATABASE_URL is left OFF
# for now (durable profiles/chats are a no-op) because the host-side daemon reaches
# Postgres only through the supavisor pooler (:5535), whose tenant DSN we add later.
umask 077
cat > "$ENVDIR/daemon/.env" <<EOF
PORT=$DPORT
HOST=127.0.0.1
CELIADOR_HOME=$ENVDIR/daemon
ANTHROPIC_API_KEY=$CELIADOR_ANTHROPIC_KEY
CELIADOR_AGENT_MODEL=$MODEL
SUPABASE_JWT_SECRET=$JWT
SUPABASE_URL=https://$HOSTN
SUPABASE_ANON_KEY=
GOTRUE_URL=http://127.0.0.1:$GPORT
# DATABASE_URL=   # add the pooler tenant DSN to enable durable profiles/chats
EOF
chmod 600 "$ENVDIR/daemon/.env"

# Install the templated unit once (harmless if already present), then start this env.
if [ ! -f /etc/systemd/system/celiador-daemon@.service ]; then
  sudo cp "$(cd "$(dirname "$0")" && pwd)/celiador-daemon@.service" /etc/systemd/system/
  sudo systemctl daemon-reload
fi
sudo systemctl enable --now "celiador-daemon@$ENV"

echo "== [$ENV] 4. verify (local) =="
sleep 2
curl -fsS "http://127.0.0.1:$DPORT/api/health" && echo && echo "✓ daemon@$ENV up on :$DPORT"
echo "GoTrue:"; curl -fsS "http://127.0.0.1:$GPORT/health" && echo

cat <<NEXT

== Still manual (prod-touching) ==
- DNS: add an A record for $HOSTN → this box.
- Caddy: add a vhost for $HOSTN (see deploy/Caddyfile.example). Reload caddy.
- Then verify end-to-end:  curl https://$HOSTN/api/health
- Isolation test: sign in on $HOSTN, use that JWT against https://celiador.ai/api/... → expect 401.
NEXT
