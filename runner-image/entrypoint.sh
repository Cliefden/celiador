#!/bin/sh
# Start the gateway bridge, wait until it listens, then hand over to Claude Code.
set -e
node /opt/celiador/gw-bridge.mjs &
for i in 1 2 3 4 5 6 7 8 9 10; do
  node -e "require('net').connect(8080,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 0.2
done
# CELIADOR_SANDBOX_EXEC lets the isolation check run a probe instead of the agent.
if [ -n "$CELIADOR_SANDBOX_EXEC" ]; then exec sh -c "$CELIADOR_SANDBOX_EXEC"; fi
exec claude "$@"
