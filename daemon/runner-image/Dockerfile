# Celiador cloud runner — one container per server run (daemon/src/runner/sandbox.ts).
# Claude Code headless + the tools an agent needs in a repo. The daemon starts it
# with --network none, a read-only root, tmpfs /tmp and $HOME, all capabilities
# dropped and its own non-root uid; the only way out is the gateway socket.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates python3 make g++ jq \
 && rm -rf /var/lib/apt/lists/*

# Pinned: a cloud run must not change behaviour because npm moved.
ARG CLAUDE_CODE_VERSION=2.1.303
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

COPY gw-bridge.mjs entrypoint.sh /opt/celiador/
RUN chmod 0755 /opt/celiador/entrypoint.sh \
 # The workspace is owned by the daemon's uid, which differs from the image's users.
 && git config --system --add safe.directory '*'

ENTRYPOINT ["/opt/celiador/entrypoint.sh"]
