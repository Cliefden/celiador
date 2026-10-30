#!/usr/bin/env bash
# Provision ONE non-prod environment (test | dev) on the box. Idempotent: safe to
# re-run after a change to compose.yml, the daemon code or this script.
#
#   CELIADOR_ANTHROPIC_KEY=sk-ant-…  [CELIADOR_SMTP_PASS=…]  ./provision-env.sh test
#   CELIADOR_ANTHROPIC_KEY=sk-ant-…  [CELIADOR_SMTP_PASS=…]  ./provision-env.sh dev
#
# Run ON the box as `stefan`, from a copy of the daemon checkout you want the
# environment to run (this script's repository root is what gets deployed).
# Prod is never touched: it keeps its own unit (celiador-daemon), its own tree
# (~/daemon) and its own Supabase stack.
#
# What one environment is (ENVIRONMENTS.md):
#   ~/envs/<env>/compose.env   the compose stack's settings + secrets (600)
#   ~/envs/<env>/deploy/       a copy of deploy/ (compose.yml, db/roles.sql)
#   ~/envs/<env>/secrets/      generated: jwt, dbpw, anon (600)
#   ~/envs/<env>/daemon/       the daemon checkout + its .env + BUILD_INFO
#   compose project celiador-<env>: postgres (loopback :PGPORT) + gotrue (:GPORT)
#   systemd celiador-daemon@<env> on :DPORT
#
# Secrets: CELIADOR_ANTHROPIC_KEY is required (the env's own key — a safe one for
# test, a cheap one for dev). CELIADOR_SMTP_PASS (stefan@celiador.ai on Migadu)
# makes magic-link sign-in work; without it GoTrue has no mailer. The JWT secret,
# the Postgres password and the anon key are generated here, kept under
# ~/envs/<env>/secrets, never echoed.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  test) DPORT=4672; GPORT=9997; PGPORT=5433; HOSTN=test.celiador.ai; MODEL=claude-opus-4-8
        APNS_TOPIC=ai.celiador.companion.test
        # The test app (ai.celiador.companion.test) and the test editor are both
        # celiador-test://; celiador://* stays for Test builds older than v0.2.5.
        ALLOW="celiador://*,celiador-test://*" ;;
  dev)  DPORT=4673; GPORT=9996; PGPORT=5434; HOSTN=dev.celiador.ai; MODEL=claude-haiku-4-5
        APNS_TOPIC=ai.celiador.companion.dev
        ALLOW="celiador-dev://*" ;;
  *) echo "usage: CELIADOR_ANTHROPIC_KEY=… $0 <test|dev>" >&2; exit 2 ;;
esac
: "${CELIADOR_ANTHROPIC_KEY:?set CELIADOR_ANTHROPIC_KEY to the Anthropic key for this environment}"

SRC="$(cd "$(dirname "$0")/.." && pwd)"     # the daemon checkout this script sits in
ENVDIR="$HOME/envs/$ENV"
SECRETS="$ENVDIR/secrets"
DOCKER="sudo docker"

umask 077

echo "== [$ENV] 0. directories + generated secrets =="
mkdir -p "$ENVDIR/daemon" "$ENVDIR/web" "$ENVDIR/deploy" "$SECRETS"
chmod 700 "$SECRETS"
[ -f "$SECRETS/jwt" ]  || openssl rand -hex 48 > "$SECRETS/jwt"
[ -f "$SECRETS/dbpw" ] || openssl rand -hex 24 > "$SECRETS/dbpw"
JWT="$(cat "$SECRETS/jwt")"
DBPW="$(cat "$SECRETS/dbpw")"
# The public "anon" key is a long-lived HS256 JWT signed with this env's secret
# (what /api/config hands the clients, as prod's kong-issued one). Regenerated
# only if the secret changed.
if [ ! -f "$SECRETS/anon" ] || ! node -e '
  const [tok, secret] = process.argv.slice(1);
  const [h, p, s] = tok.split(".");
  const sig = require("crypto").createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  process.exit(sig === s ? 0 : 1);' "$(cat "$SECRETS/anon" 2>/dev/null || echo x.y.z)" "$JWT"; then
  node -e '
    const secret = process.argv[1];
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "anon", iss: "supabase", iat: now, exp: now + 10 * 365 * 86400 })}`;
    const sig = require("crypto").createHmac("sha256", secret).update(input).digest("base64url");
    process.stdout.write(`${input}.${sig}`);' "$JWT" > "$SECRETS/anon"
fi
ANON="$(cat "$SECRETS/anon")"

echo "== [$ENV] 1. compose stack: postgres :$PGPORT + gotrue :$GPORT =="
rsync -a --delete "$SRC/deploy/" "$ENVDIR/deploy/"
cat > "$ENVDIR/compose.env" <<EOF
CELIADOR_ENV=$ENV
HOST=$HOSTN
POSTGRES_PORT=$PGPORT
GOTRUE_PORT=$GPORT
POSTGRES_PASSWORD=$DBPW
JWT_SECRET=$JWT
GOTRUE_URI_ALLOW_LIST=$ALLOW
SMTP_HOST=${CELIADOR_SMTP_PASS:+smtp.migadu.com}
SMTP_PORT=587
SMTP_USER=${CELIADOR_SMTP_PASS:+stefan@celiador.ai}
SMTP_PASS=${CELIADOR_SMTP_PASS:-}
SMTP_SENDER_NAME=Celiador
EOF
$DOCKER compose -p "celiador-$ENV" --env-file "$ENVDIR/compose.env" -f "$ENVDIR/deploy/compose.yml" up -d --wait

echo "== [$ENV] 2. daemon checkout + .env + BUILD_INFO =="
# Anchored excludes: an unanchored `data` would also drop src/data/ (the data
# routes). data/ and releases/ (the editor update feed) are the env's state,
# never part of a deploy.
rsync -a --delete --exclude '/.git' --exclude '/node_modules' --exclude '/data' --exclude '/releases' \
  --exclude '/.env' --exclude '/.env.*' --exclude '/BUILD_INFO' --exclude '.DS_Store' --exclude '/.claude' \
  "$SRC/" "$ENVDIR/daemon/"
( cd "$ENVDIR/daemon" && npm ci --omit=dev )
commit="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
printf 'commit=%s\ndeployed_at=%s\n' "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENVDIR/daemon/BUILD_INFO"
# Magic links need the mailer wired in step 1; without it /api/config tells the
# clients to hide that option.
MAGIC_LINK="${CELIADOR_SMTP_PASS:+1}"
MAGIC_LINK="${MAGIC_LINK:-0}"
cat > "$ENVDIR/daemon/.env" <<EOF
# Generated by deploy/provision-env.sh — edit and restart celiador-daemon@$ENV.
CELIADOR_ENV=$ENV
PORT=$DPORT
HOST=127.0.0.1
CELIADOR_HOME=$ENVDIR/daemon
CELIADOR_PUBLIC_URL=https://$HOSTN
ANTHROPIC_API_KEY=$CELIADOR_ANTHROPIC_KEY
CELIADOR_AGENT_MODEL=$MODEL
DATABASE_URL=postgres://postgres:$DBPW@127.0.0.1:$PGPORT/postgres
SUPABASE_JWT_SECRET=$JWT
SUPABASE_URL=https://$HOSTN
SUPABASE_ANON_KEY=$ANON
CELIADOR_MAGIC_LINK=$MAGIC_LINK
GOTRUE_URL=http://127.0.0.1:$GPORT
APNS_TOPIC=$APNS_TOPIC
APNS_ENV=production
# APNS_KEY_ID= / APNS_TEAM_ID= / APNS_KEY_PATH= : add to enable push (the team key serves every app)
EOF

echo "== [$ENV] 3. schema =="
( cd "$ENVDIR/daemon" && npm run --silent migrate )

echo "== [$ENV] 4. systemd celiador-daemon@$ENV on :$DPORT =="
if ! cmp -s "$SRC/deploy/celiador-daemon@.service" /etc/systemd/system/celiador-daemon@.service; then
  sudo cp "$SRC/deploy/celiador-daemon@.service" /etc/systemd/system/
  sudo systemctl daemon-reload
fi
sudo systemctl enable --now "celiador-daemon@$ENV"
sudo systemctl restart "celiador-daemon@$ENV"

echo "== [$ENV] 5. verify (loopback) =="
for _ in $(seq 1 20); do
  if health="$(curl -fsS "http://127.0.0.1:$DPORT/api/health" 2>/dev/null)"; then break; fi
  sleep 1
done
[ -n "${health:-}" ] || { sudo journalctl -u "celiador-daemon@$ENV" -n 40 --no-pager >&2; echo "daemon@$ENV never answered on :$DPORT" >&2; exit 1; }
echo "$health" | grep -q "\"env\":\"$ENV\"" || { echo "daemon on :$DPORT reports the wrong env: $health" >&2; exit 1; }
echo "$health"
echo "GoTrue: $(curl -fsS "http://127.0.0.1:$GPORT/health")"

cat <<NEXT

✔ $ENV is up: daemon :$DPORT ($commit), gotrue :$GPORT, postgres :$PGPORT

== Still manual (shared with prod) ==
- Caddy: add the $HOSTN vhost from deploy/Caddyfile.example, then
    sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
- Then end-to-end:  curl https://$HOSTN/api/health
- Isolation: sign in on $HOSTN, use that JWT against https://celiador.ai/api/me → expect 401.
NEXT
