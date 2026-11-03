# Cloud runs: switching the sandboxed runner on

The sandboxed runner (`src/runner/sandbox.ts`) runs the real Claude agent in a per-run Docker container: no network except a Unix-socket bridge to the daemon's gateway, read-only root, tmpfs `/tmp`, all capabilities dropped, non-root, 30-minute cap, killed on cancel.

The agent inside is treated as untrusted (it reads repo content, so it can be prompt-injected). Two layers keep it to the model: the socket bridge is an HTTP proxy that forwards only `/api/anthropic/*` (anything else gets a 403 from the bridge, per request, kept-alive connections included), and the run's token is a **runner token** that the daemon accepts on the Anthropic gateway only — every `requireUser` route (sessions, `git/*`, tasks, profile, chats, account, push, …) and the locked `/api/agent/messages` proxy answer 403 to it. Nothing the agent needs goes through those routes: its events reach the relay from the daemon process reading the container's stdout. It is built and verified (`scripts/sandbox-check.ts`) but **off** until the daemon's user can run Docker.

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

With `CELIADOR_RUNNER_AGENT=sandbox` the daemon routes a queued task to the editor when one is online with the repository open, and to the sandbox otherwise (the laptop-off case). The **GitHub App must be installed on the repository** (`docs/GITHUB_APP.md`): the container has no network, so the daemon does the git work around it with the App's installation token — and that is what pushes the branch and opens the pull request. A repository without the App keeps its task `queued` with `error: "waiting for an editor: cloud runs need the Celiador GitHub App on this repo"` (the repo isn't asked about again for 10 minutes), until an editor with it open comes online. (`POST /api/sessions` with `runner: "server"` — a **cloud session** started from the phone, not tied to a task — is described below.)

A cloud task's run, step by step (`src/tasks/cloud.ts`):

1. Dispatch marks the task `dispatched` / `runner: "cloud"`, creates a relay session (`origin: "phone"`, `runner: "server"`, title = the task) linked to it, and moves it to `running` — the "Picked up" comment says "in the Celiador cloud".
2. Workspace: a git worktree of the user's mirror of the repo (see "Worktrees" below) on `<task.branch>`, new from the default branch (or from the branch's remote tip when an earlier attempt already pushed it). The agent runs in the container with the task prompt; its gateway requests are attributed to the session (`usage`).
3. After the container exits: whatever the agent left uncommitted is committed as `"<title> (#n)"` by `Celiador <noreply@celiador.ai>`; the branch is pushed to `https://x-access-token:<token>@github.com/owner/name.git` with `--force-with-lease` against the sha the branch had when the turn started (the token is only ever in that one command's argv, never in `.git/config` — the workspace is browsable from the phone); the pull request is opened as the App (base = default branch, body per `docs/CLIENT_INTEGRATION.md`); the task is `pr-open` with the PR's size, the "Pull request opened" comment is posted and the PR card refreshed.
4. An agent that changed nothing → `failed` ("The agent finished without changing anything.") with a **Failed.** comment; any other error → `failed` with a readable message.

Follow-ups (`POST /api/tasks/:id/followup`, and the checks-failed auto-fix) run another turn in the same retained workspace — fast-forwarding onto the branch first if someone pushed to it — and finish the same way (PR body refreshed via PATCH). Cancel (`POST /api/tasks/:id/cancel` or the session's cancel) kills the container; the task and session end `cancelled`. Cloud runs count against the user's `CELIADOR_TASK_CONCURRENCY` slots like editor runs. Workspaces are swept at boot (`reapOrphanRuns`); a follow-up after a restart re-clones and picks the branch up from GitHub, and cloud tasks a dead daemon left `dispatched` / `running` go back to `queued` on the next dispatch.

Without the runner image the daemon re-queues the task with the sandbox's own message and doesn't probe Docker again for a minute.

## Worktrees

Every cloud checkout — task or session — is a `git worktree`, not a clone (`src/runner/worktrees.ts`):

- Each user has one bare **mirror** per repository, `data/repos/<userId>/<hash of the URL>.git`. It is fetched (`+refs/heads/*:refs/remotes/origin/*`, `origin/HEAD` set to the default branch) before each new worktree, so a repo is downloaded once and then only incrementally. The mirror never stores a remote URL or token: the App token rides in the URL of the one command, as before.
- A run's workspace, `data/runs/<userId>/<runId>/repo`, is `git worktree add -B <branch>` of that mirror. Git refuses to check one branch out twice, so two runs can't share a branch.
- In the sandbox the mirror is mounted read-write **at its own path** (a worktree's `.git` file points there); it holds only that user's copy of that repo. The run's `$HOME` is now `data/runs/<userId>/<runId>/home` instead of a tmpfs, so a follow-up turn can `claude --continue` the conversation.
- Mirror mutations (fetch, worktree add / remove / prune) are serialised per mirror. Deleting a session removes its worktree and local branch. The boot sweep still removes `data/runs/` (and `git worktree prune` releases those branches on the next fetch); a session whose workspace went that way checks its branch out again on its next follow-up — from GitHub if it was pushed. Mirrors are kept across restarts and removed with the account.

## Cloud sessions from the phone

`POST /api/sessions` with `runner: "server"` (`src/sessions/cloudSession.ts`; API in `docs/CLIENT_INTEGRATION.md`): a worktree on a new `celiador/…` branch off the chosen base (or directly on an existing branch), the agent runs, and the phone can send follow-ups (another turn, same worktree, `--continue`) and review the result with the same `git/*` endpoints editor runs use — the daemon commits, pushes and opens / merges the pull request with the App. The App's token is used only for repos linked to that user (`POST /api/tasks/repos`); a repo linked to another account is refused, and any other public repo runs anonymously without push.

- **Follow-ups catch up with GitHub first.** Before the turn the daemon fetches the session's branch and fast-forwards the worktree onto anything that landed there (a reviewer's commit, a push from the editor). It refuses the turn — session `error` with the reason, no agent run — when the branch was deleted on GitHub after the session had it there (e.g. its PR was merged), when the two sides diverged, or when the incoming commits touch files with uncommitted changes. A failed fetch isn't fatal: the turn runs on the session's copy and the push re-checks.
- **Pushing an existing branch is fast-forward only.** On an `existingBranch` session (which may be the default branch) the daemon fetches the branch's live tip and pushes without force only if that tip is an ancestor of the session's HEAD; otherwise (an agent amend / rebase / reset of pushed commits, or new commits on GitHub) the push is refused with the reason and nothing on GitHub changes. The session's own fresh `celiador/…` branch is still pushed with `--force-with-lease` against the last sha the session pushed: it is the session's scratch branch, so the agent tidying its own unmerged commits is allowed, and the lease refuses to overwrite anything someone else pushed since.

## Rollback

Unset `CELIADOR_RUNNER_AGENT` (or set it to anything but `sandbox`) and restart: cloud runs fall back to the placeholder agent, which executes no model-driven code.
