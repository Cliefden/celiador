#!/usr/bin/env bash
# Deploy the Celiador daemon to one environment on the box, by hand.
#
#   ./deploy/deploy.sh <env>        # env = test | dev | prod
#
# Run from a local daemon checkout that is on the ref you want to ship. It
# rsyncs the tree to ~/envs/<env>/daemon, installs deps, applies migrations,
# restarts the env's systemd instance and checks health through Caddy.
# Secrets are NOT touched: they live in ~/envs/<env>/daemon/.env, written by
# deploy/provision-env.sh.
#
# This is the manual path. The GitHub Actions workflow (deploy.yml, issue #42)
# runs the same steps from a hosted runner: push to main → dev, tag → test,
# dispatch → prod. Prod needs the cutover to celiador-daemon@prod first
# (ENVIRONMENTS.md); until then deploy prod the old way (~/daemon + the plain unit).
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  prod) PORT=4671; HOST=celiador.ai ;;
  test) PORT=4672; HOST=test.celiador.ai ;;
  dev)  PORT=4673; HOST=dev.celiador.ai ;;
  *) echo "usage: $0 <test|dev|prod>" >&2; exit 2 ;;
esac

BOX="${CELIADOR_BOX:-stefan@cliefden.com}"
REMOTE_DIR="envs/$ENV/daemon"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/"
COMMIT="$(git -C "$LOCAL_DIR" rev-parse HEAD)"

echo "→ Deploying daemon $COMMIT to [$ENV] on $BOX ($REMOTE_DIR)"

# Excludes are anchored with a leading "/" so they only match at the tree root —
# an unanchored `data` would also drop src/data/ (the daemon's data routes).
# data/ and releases/ (the editor update feed) are the env's state, never deployed.
rsync -az --delete \
  --exclude /.git --exclude /node_modules --exclude /data --exclude /releases --exclude /.claude \
  --exclude '/.env' --exclude '/.env.*' --exclude '/BUILD_INFO' --exclude '.DS_Store' \
  "$LOCAL_DIR" "$BOX:$REMOTE_DIR/"

# Install prod deps (tsx is a runtime dependency — `npm start` runs src/main.ts
# through it, no build step), stamp the commit, migrate, restart the instance.
ssh "$BOX" "cd ~/$REMOTE_DIR \
  && npm ci --omit=dev \
  && printf 'commit=%s\ndeployed_at=%s\n' '$COMMIT' \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > BUILD_INFO \
  && npm run --silent migrate \
  && sudo systemctl restart celiador-daemon@$ENV"

# Health gate through the public host: the daemon answering must be this env
# and this commit, not something else holding the port.
echo "→ Health check https://$HOST/api/health"
health="$(curl -fsS "https://$HOST/api/health")"
echo "$health"
grep -q "\"env\":\"$ENV\"" <<<"$health" || { echo "✗ wrong env answered" >&2; exit 1; }
grep -q "\"commit\":\"$COMMIT\"" <<<"$health" || { echo "✗ daemon reports a different commit" >&2; exit 1; }
echo "✓ $ENV is running $COMMIT on :$PORT"
