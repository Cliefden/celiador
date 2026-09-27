#!/usr/bin/env bash
# Deploy the Celiador daemon to one environment on the box.
#
#   ./deploy/deploy.sh <env>        # env = prod | staging | dev
#
# Run from a local daemon checkout that is on the ref you want to ship
# (prod ⇐ main/release tag, staging ⇐ staging branch, dev ⇐ dev branch).
# It rsyncs the tree to ~/envs/<env>/daemon, installs deps, restarts the
# matching systemd instance, and smoke-checks health. Secrets are NOT touched:
# they live in ~/envs/<env>/daemon.env, managed out-of-band.
set -euo pipefail

ENV="${1:-}"
case "$ENV" in
  prod)    PORT=4671; HOST=celiador.ai ;;
  staging) PORT=4672; HOST=staging.celiador.ai ;;
  dev)     PORT=4673; HOST=dev.celiador.ai ;;
  *) echo "usage: $0 <prod|staging|dev>" >&2; exit 2 ;;
esac

BOX="${CELIADOR_BOX:-stefan@cliefden.com}"
REMOTE_DIR="envs/$ENV/daemon"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/"

echo "→ Deploying daemon to [$ENV] on $BOX ($REMOTE_DIR)"

# Excludes are anchored with a leading "/" so they only match at the tree root —
# an unanchored `data` would also drop src/data/ (the daemon's data routes).
rsync -az --delete \
  --exclude /.git --exclude /node_modules --exclude /data \
  --exclude '.env' --exclude '.env.*' \
  "$LOCAL_DIR" "$BOX:$REMOTE_DIR/"

# Install prod deps (tsx is a runtime dependency — `npm start` runs src/main.ts
# through it, no build step) and restart the env's instance.
ssh "$BOX" "cd ~/$REMOTE_DIR && npm ci --omit=dev && sudo systemctl restart celiador-daemon@$ENV"

# Smoke check via the public subdomain (through Caddy).
echo "→ Health check https://$HOST/api/health"
curl -fsS "https://$HOST/api/health" && echo && echo "✓ $ENV is up on :$PORT"
