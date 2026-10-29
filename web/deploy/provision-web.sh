#!/usr/bin/env bash
# Provision the marketing site for ONE environment (test | dev | prod) on the
# box: ~/envs/<env>/web.env, a first build of this checkout, and the
# celiador-web@<env> unit. Idempotent. Run ON the box as `stefan`, from a copy
# of the celiador-web checkout you want the environment to run.
#
#   ./deploy/provision-web.sh test
#   ./deploy/provision-web.sh dev
#
# Prod keeps the plain `celiador-web` unit (~/celiador-web, :3100) until its
# cutover; `provision-web.sh prod` prepares ~/envs/prod/web beside it without
# stopping anything (daemon/ENVIRONMENTS.md § Prod cutover).
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  prod) PORT=3100; HOSTN=celiador.ai ;;
  test) PORT=3102; HOSTN=test.celiador.ai ;;
  dev)  PORT=3103; HOSTN=dev.celiador.ai ;;
  *) echo "usage: $0 <test|dev|prod>" >&2; exit 2 ;;
esac

SRC="$(cd "$(dirname "$0")/.." && pwd)"
ENVDIR="$HOME/envs/$ENV"
mkdir -p "$ENVDIR/web"

echo "== [$ENV] 1. settings → $ENVDIR/web.env =="
# Read by the unit (EnvironmentFile) and by Next at build + run time. The site
# reads its environment's own release listing, never prod's.
cat > "$ENVDIR/web.env" <<EOF
PORT=$PORT
NODE_ENV=production
CELIADOR_ENV=$ENV
CELIADOR_RELEASES_API=https://$HOSTN/api/releases
EOF

echo "== [$ENV] 2. checkout + build =="
rsync -a --delete --exclude '/.git' --exclude '/node_modules' --exclude '/.next' \
  --exclude '/.claude' --exclude '.DS_Store' --exclude '/.env*' "$SRC/" "$ENVDIR/web/"
commit="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
printf 'commit=%s\ndeployed_at=%s\n' "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENVDIR/web/BUILD_INFO"
( cd "$ENVDIR/web" && set -a && . "$ENVDIR/web.env" && set +a && npm ci && npm run build )

if [[ "$ENV" == prod ]] && systemctl is-active --quiet celiador-web; then
  echo "== [prod] built into $ENVDIR/web; the plain celiador-web unit still serves :3100 (cutover is a separate step) =="
  exit 0
fi

echo "== [$ENV] 3. systemd celiador-web@$ENV on :$PORT =="
if ! cmp -s "$SRC/deploy/celiador-web@.service" /etc/systemd/system/celiador-web@.service; then
  sudo cp "$SRC/deploy/celiador-web@.service" /etc/systemd/system/
  sudo systemctl daemon-reload
fi
sudo systemctl enable --now "celiador-web@$ENV"
sudo systemctl restart "celiador-web@$ENV"

echo "== [$ENV] 4. verify (loopback) =="
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/" | grep -q Celiador; then
    echo "✔ celiador-web@$ENV answers on :$PORT ($commit)"
    exit 0
  fi
  sleep 1
done
sudo journalctl -u "celiador-web@$ENV" -n 40 --no-pager >&2
echo "celiador-web@$ENV never answered on :$PORT" >&2
exit 1
