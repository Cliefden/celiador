# Cloud runs: switching the sandboxed runner on

The sandboxed runner (`src/runner/sandbox.ts`) runs the real Claude agent in a per-run Docker container: no network except a Unix-socket bridge to the daemon's gateway, read-only root, tmpfs `/tmp`, all capabilities dropped, non-root, 30-minute cap, killed on cancel.

The agent inside is treated as untrusted (it reads repo content, so it can be prompt-injected). Two layers keep it to the model: the socket bridge is an HTTP proxy that forwards only `/api/anthropic/*` (anything else gets a 403 from the bridge, per request, kept-alive connections included), and the run's token is a **runner token** that the daemon accepts on the Anthropic gateway only — every `requireUser` route (sessions, `git/*`, tasks, profile, chats, account, push, …) and the locked `/api/agent/messages` proxy answer 403 to it. A runner token is also good only while its run is: the daemon revokes it when the run ends (done, failed, cancelled or timed out), and refuses one minted by an earlier daemon process (401), so a token copied out of a container can't spend the user's quota afterwards (#80). Nothing the agent needs goes through those routes: its events reach the relay from the daemon process reading the container's stdout. It is built and verified (`scripts/sandbox-check.ts`) but **off** until the daemon's user can run Docker.

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

With `CELIADOR_RUNNER_AGENT=sandbox` the daemon routes a queued task to the editor when one is online with the repository open, and to the sandbox otherwise (the laptop-off case). The **GitHub App must be installed on the repository** (`docs/GITHUB_APP.md`): the container has no network, so the daemon does the git work around it with the App's installation token — and that is what pushes the branch and opens the pull request. The task's repo must also be linked to the user **with a proof** of their GitHub write access (`docs/GITHUB_APP.md` § Proof of access); without one the task stays `queued` with `error: "waiting for an editor: cloud runs need this repo in your repos, verified with your GitHub account (connect GitHub in Celiador)"` and the App is never asked. A repository without the App keeps its task `queued` with `error: "waiting for an editor: cloud runs need the Celiador GitHub App on this repo"` (the repo isn't asked about again for 10 minutes), until an editor with it open comes online. (`POST /api/sessions` with `runner: "server"` — a **cloud session** started from the phone, not tied to a task — is described below.)

A cloud task's run, step by step (`src/tasks/cloud.ts`):

1. Dispatch marks the task `dispatched` / `runner: "cloud"`, creates a relay session (`origin: "phone"`, `runner: "server"`, title = the task) linked to it, and moves it to `running` — the "Picked up" comment says "in the Celiador cloud".
2. Workspace: a git worktree of the user's mirror of the repo (see "Worktrees" below) on `<task.branch>`, new from the default branch (or from the branch's remote tip when an earlier attempt already pushed it). The agent runs in the container with the task prompt; its gateway requests are attributed to the session (`usage`).
3. After the container exits: whatever the agent left uncommitted is committed as `"<title> (#n)"` by `Celiador <noreply@celiador.ai>`; the branch is pushed to `https://x-access-token:<token>@github.com/owner/name.git` with `--force-with-lease` against the sha the branch had when the turn started (the token is only ever in that one command's argv, never in `.git/config` — the workspace is browsable from the phone); the pull request is opened as the App (base = default branch, body per `docs/CLIENT_INTEGRATION.md`); the task is `pr-open` with the PR's size, the "Pull request opened" comment is posted and the PR card refreshed.
4. An agent that changed nothing → `failed` ("The agent finished without changing anything.") with a **Failed.** comment; any other error → `failed` with a readable message.

Follow-ups (`POST /api/tasks/:id/followup`, and the checks-failed auto-fix) run another turn in the same retained workspace — fast-forwarding onto the branch first if someone pushed to it — and finish the same way (PR body refreshed via PATCH). Cancel (`POST /api/tasks/:id/cancel` or the session's cancel) kills the container; the task and session end `cancelled`. Cloud runs count against the user's `CELIADOR_TASK_CONCURRENCY` slots like editor runs. Workspaces survive a restart: the boot sweep (`runner/reap.ts`) removes only those whose session is gone or idle past `CELIADOR_RUN_WORKSPACE_TTL_HOURS` (default 7 days), then prunes the mirrors' worktree lists and removes mirrors no workspace uses any more; a follow-up on a swept workspace checks the branch out again (from GitHub if it was pushed), and cloud tasks a dead daemon left `dispatched` / `running` go back to `queued` on the next dispatch.

Without the runner image the daemon re-queues the task with the sandbox's own message and doesn't probe Docker again for a minute.

## Worktrees

Every cloud checkout — task or session — is a `git worktree`, not a clone (`src/runner/worktrees.ts`):

- Each user has one bare **mirror** per repository, `data/repos/<userId>/<hash of the URL>.git`. It is fetched (`+refs/heads/*:refs/remotes/origin/*`, `origin/HEAD` set to the default branch) before each new worktree, so a repo is downloaded once and then only incrementally. The mirror never stores a remote URL or token: the App token rides in the URL of the one command, as before.
- A run's workspace, `data/runs/<userId>/<runId>/repo`, is `git worktree add -B <branch>` of that mirror. Git refuses to check one branch out twice, so two runs can't share a branch.
- In the sandbox the mirror is mounted **at its own path** (a worktree's `.git` file points there), **read-only**; writable on top of it are only what a commit in the worktree writes: `objects/`, `refs/`, `logs/` and the worktree's own metadata dir (`worktrees/<id>`: HEAD, index). So the agent can't change the mirror's `config` or `hooks/`, and an in-container `git worktree prune` can't deregister the user's other worktrees. The workspace is also mounted at its host path so the worktree's `gitdir` back-pointer resolves inside. Commits made in the container get their identity from `GIT_AUTHOR_*` / `GIT_COMMITTER_*` (local `git config` fails: the config is read-only). It holds only that user's copy of that repo. The run's `$HOME` is now `data/runs/<userId>/<runId>/home` instead of a tmpfs, so a follow-up turn can `claude --continue` the conversation.
- **Host-side git never trusts the agent's tree (#78).** Every git command the daemon runs on a workspace or mirror goes through `git()` in `src/runner/workspace.ts`: no system / global config (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`); `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, no submodule recursion, no signing programs, no `ext::`; `--git-dir` / `--work-tree` / `GIT_COMMON_DIR` from a location file the daemon writes when it makes the worktree (`data/runs/<userId>/<runId>/repo.gitloc.json`, never mounted), so the workspace's `.git` file and `commondir` are never followed (a workspace without that file is refused); and before each command the mirror's `config` is compared byte for byte with the daemon's canonical one and rewritten if it differs, and `objects/info/alternates` is removed. Repo config is owned outright rather than filtered key by key, because the dangerous keys (`include.path`, `core.sshCommand`, `credential.helper`, `url.*.insteadOf`, filter / diff / merge drivers, `gpg.program`, …) are too many to blocklist. Diffs also pass `--no-ext-diff --no-textconv --ignore-submodules=all`.
- Mirror mutations (fetch, worktree add / remove / prune) are serialised per mirror. Deleting a session (`DELETE /api/sessions/:id`) first cancels its run if one is working (and waits for a checkout in progress and the run to stop), then removes its worktree and workspace — for cloud sessions and cloud tasks' sessions alike (#80; before, a cloud task's session only lost its directory, and its worktree was pruned on a later fetch). A cloud session also drops its local branch; a task's branch stays. The boot sweep still removes `data/runs/` of sessions that are gone or idle (and `git worktree prune` releases those branches); a session whose workspace went that way checks its branch out again on its next follow-up — from GitHub if it was pushed.
- **The agent's conversation goes with the workspace.** `$HOME` (`data/runs/<userId>/<runId>/home`, where Claude Code keeps the conversation) is in the same run directory, so when the boot sweep removes it the next follow-up's `--continue` has nothing to continue: the agent starts a new conversation, with only the branch's state (the session's log says so). While the run directory survives a restart, so does the conversation.
- **Disk use (#80).** Cloud runs fetch `https://github.com/<owner>/<name>` repositories only (`POST /api/sessions` answers 400 for any other URL), never an arbitrary host. A mirror is in use while one of the user's workspaces is a worktree of it (per the daemon's location records). A mirror no workspace uses is removed when its last session is deleted and at the boot sweep, and is simply fetched again by the next run on that repo. The user's mirrors together are capped at `CELIADOR_MIRROR_QUOTA_MB` (default 4096; `0` = no cap): after each fetch for a new worktree, the user's unused mirrors are evicted least recently fetched first until they fit; if they still don't, the checkout is refused with the reason ("this repository is too large for cloud runs…" or "…over the … MB limit; delete cloud sessions you've finished with") and the new mirror removed. A mirror in use is never evicted. A fetch that fails or is killed at its 3-minute timeout removes the temporary pack (`objects/pack/tmp_pack_*`) it left; the boot sweep drops any older than an hour. Mirrors are full clones, not partial (`--filter=blob:none`): a partial clone fetches missing blobs from its remote on demand, but the mirror stores no remote and the sandbox has no network, so `git diff` / `log -p` on older commits would fail there. All of a user's mirrors are removed with the account.

## Cloud sessions from the phone

`POST /api/sessions` with `runner: "server"` (`src/sessions/cloudSession.ts`; API in `docs/CLIENT_INTEGRATION.md`): a worktree on a new `celiador/…` branch off the chosen base (or directly on an existing branch), the agent runs, and the phone can send follow-ups (another turn, same worktree, `--continue`) and review the result with the same `git/*` endpoints editor runs use — the daemon commits, pushes and opens / merges the pull request with the App. The App's token is used only for repos linked to that user (`POST /api/tasks/repos`) with a proof that their own GitHub account can write there (`docs/GITHUB_APP.md` § Proof of access, re-checked hourly); a repo linked to another account is refused, and any other public repo (or an own link without a proof) runs anonymously without push.

- **One turn at a time.** A follow-up is refused (409) while the session's run is working or while an earlier follow-up is still checking the branch out or catching up with GitHub (before its run starts), and one sent before the first checkout has finished gets "the session is still checking out the repo". Review writes (`git/commit`, `revert`, `push`, `pr`, `merge`) are refused the same way while either is going on.
- **Follow-ups catch up with GitHub first.** Before the turn the daemon fetches the session's branch and fast-forwards the worktree onto anything that landed there (a reviewer's commit, a push from the editor). It refuses the turn — session `error` with the reason, no agent run — when the branch was deleted on GitHub after the session had it there (e.g. its PR was merged), when the two sides diverged, or when the incoming commits touch files with uncommitted changes. A failed fetch isn't fatal: the turn runs on the session's copy and the push re-checks.
- **Pushing an existing branch is fast-forward only.** On an `existingBranch` session (which may be the default branch) the daemon fetches the branch's live tip and pushes without force only if that tip is an ancestor of the session's HEAD; otherwise (an agent amend / rebase / reset of pushed commits, or new commits on GitHub) the push is refused with the reason and nothing on GitHub changes. The session's own fresh `celiador/…` branch is still pushed with `--force-with-lease` against the last sha the session pushed: it is the session's scratch branch, so the agent tidying its own unmerged commits is allowed, and the lease refuses to overwrite anything someone else pushed since.

## Rollback

Unset `CELIADOR_RUNNER_AGENT` (or set it to anything but `sandbox`) and restart: cloud runs fall back to the placeholder agent, which executes no model-driven code.
