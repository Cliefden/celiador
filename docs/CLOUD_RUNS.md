# Cloud runs: switching the sandboxed runner on

The sandboxed runner (`src/runner/sandbox.ts`) runs the real Claude agent in a per-run Docker container: no network except a Unix-socket bridge to the daemon's gateway, read-only root, tmpfs, all capabilities dropped, non-root, 30-minute cap, killed on cancel. It is built and verified (`scripts/sandbox-check.ts`) but **off** until the daemon's user can run Docker.

Decision (2026-10-22): **rootless Docker for the daemon user**, not the `docker` group (which is root-equivalent).

## One-time setup on the box (as `stefan`, who has sudo)

```sh
# 1. Prerequisites for rootless mode (Debian/Ubuntu).
sudo apt-get install -y uidmap dbus-user-session slirp4netns

# 2. Let the user session (and its systemd services) outlive logins.
sudo loginctl enable-linger stefan

# 3. Install the rootless Docker daemon for this user (no sudo from here on).
dockerd-rootless-setuptool.sh install

# 4. Make the rootless socket the default for this user.
echo 'export DOCKER_HOST=unix:///run/user/1001/docker.sock' >> ~/.bashrc
export DOCKER_HOST=unix:///run/user/1001/docker.sock
docker info | grep -i rootless      # expect "rootless"

# 5. Build the runner image under the rootless daemon (the root-owned one is not visible to it).
cd ~/daemon && docker build -t celiador-runner:1 runner-image

# 6. Point the systemd unit at the rootless socket and turn the agent on.
sudo systemctl edit celiador-daemon
#   [Service]
#   Environment=DOCKER_HOST=unix:///run/user/1001/docker.sock
#   Environment=CELIADOR_RUNNER_AGENT=sandbox
sudo systemctl restart celiador-daemon

# 7. Verify the isolation flags with the daemon's own check (no sudo: rootless).
cd ~/daemon && npx tsx scripts/sandbox-check.ts
```

If `dockerd-rootless-setuptool.sh` is missing, install Docker's `docker-ce-rootless-extras` package first (`sudo apt-get install -y docker-ce-rootless-extras`).

## What it means for the queue

With `CELIADOR_RUNNER_AGENT=sandbox` the daemon routes a queued task to the editor when one is online with the repository open, and to the sandbox otherwise (the laptop-off case). Private repositories need the GitHub App (`docs/GITHUB_APP.md`) for the clone token; public ones work without it.

## Rollback

Unset `CELIADOR_RUNNER_AGENT` (or set it to anything but `sandbox`) and restart: cloud runs fall back to the placeholder agent, which executes no model-driven code.
