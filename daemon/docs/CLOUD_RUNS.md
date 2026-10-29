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

With `CELIADOR_RUNNER_AGENT=sandbox` the daemon routes a queued task to the editor when one is online with the repository open, and to the sandbox otherwise (the laptop-off case). The **GitHub App must be installed on the repository** (`docs/GITHUB_APP.md`): the container has no network, so the daemon does the git work around it with the App's installation token — and that is what pushes the branch and opens the pull request. A repository without the App keeps its task `queued` with `error: "waiting for an editor: cloud runs need the Celiador GitHub App on this repo"` (the repo isn't asked about again for 10 minutes), until an editor with it open comes online. (`POST /api/sessions` with `runner: "server"` — a cloud run not tied to a task — still works as before, public repos included; it clones, runs and publishes diffs but pushes nothing.)

A cloud task's run, step by step (`src/tasks/cloud.ts`):

1. Dispatch marks the task `dispatched` / `runner: "cloud"`, creates a relay session (`origin: "phone"`, `runner: "server"`, title = the task) linked to it, and moves it to `running` — the "Picked up" comment says "in the Celiador cloud".
2. Workspace: shallow clone of the default branch, `git switch -c <task.branch>` (or the branch's remote tip when an earlier attempt already pushed it). The agent runs in the container with the task prompt; its gateway requests are attributed to the session (`usage`).
3. After the container exits: whatever the agent left uncommitted is committed as `"<title> (#n)"` by `Celiador <noreply@celiador.ai>`; the branch is pushed to `https://x-access-token:<token>@github.com/owner/name.git` with `--force-with-lease` against the sha the branch had when the turn started (the token is only ever in that one command's argv, never in `.git/config` — the workspace is browsable from the phone); the pull request is opened as the App (base = default branch, body per `docs/CLIENT_INTEGRATION.md`); the task is `pr-open` with the PR's size, the "Pull request opened" comment is posted and the PR card refreshed.
4. An agent that changed nothing → `failed` ("The agent finished without changing anything.") with a **Failed.** comment; any other error → `failed` with a readable message.

Follow-ups (`POST /api/tasks/:id/followup`, and the checks-failed auto-fix) run another turn in the same retained workspace — fast-forwarding onto the branch first if someone pushed to it — and finish the same way (PR body refreshed via PATCH). Cancel (`POST /api/tasks/:id/cancel` or the session's cancel) kills the container; the task and session end `cancelled`. Cloud runs count against the user's `CELIADOR_TASK_CONCURRENCY` slots like editor runs. Workspaces are swept at boot (`reapOrphanRuns`); a follow-up after a restart re-clones and picks the branch up from GitHub, and cloud tasks a dead daemon left `dispatched` / `running` go back to `queued` on the next dispatch.

Without the runner image the daemon re-queues the task with the sandbox's own message and doesn't probe Docker again for a minute.

## Rollback

Unset `CELIADOR_RUNNER_AGENT` (or set it to anything but `sandbox`) and restart: cloud runs fall back to the placeholder agent, which executes no model-driven code.
