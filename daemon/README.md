# celiador-daemon (`Cliefden/daemon`)

Celiador is the loop: label a GitHub issue `celiador` and an agent runs it in its
own git worktree, comments on the issue, opens a pull request that closes it, and
you review and merge from your phone. This daemon is the hub that loop runs
through. It receives the GitHub App's webhooks and turns labelled issues into
queued tasks, dispatches them to whichever runner has the repository open (the
Celiador editor, or VS Code and Cursor with the Celiador Remote extension) — or to
its own sandboxed cloud runner when none does (cloud runs need the GitHub App on
the repository, to push and open the pull request), relays each run to the phone
so it can be watched and steered, proxies the agent's requests to Anthropic on the
server-held key with published per-user limits and a per-run cost, verifies
Supabase sign-in, sends APNs pushes, keeps profile and chat history, and serves
the editor's release feed. No client ever holds the model key.

Auth is Supabase HS256 JWT verification (multi-user), a shared-token mode, or open
localhost dev (only with `CELIADOR_ALLOW_NO_AUTH=1` on a loopback HOST — otherwise
the daemon refuses to start without auth configured).

> This replaces the previous monorepo backend, now archived at
> [`Cliefden/daemon-old`](https://github.com/Cliefden/daemon-old) (local
> `../daemon-old`). The old spec/codegen engine, studio web UI, Expo publishing,
> previews, and spreadsheet import were intentionally dropped.

## Stack

Node ≥20 · TypeScript · [Hono](https://hono.dev) (+ `@hono/node-server`) · run via
`tsx` (no build step). Deployed on the box under `systemd`, same model as before.

## Develop

```sh
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY; for no-auth local dev set CELIADOR_ALLOW_NO_AUTH=1
npm run dev               # tsx watch → http://127.0.0.1:4661
npm run typecheck
```

Smoke test:

```sh
curl -s localhost:4661/api/health      # {"ok":true,"name":"celiador-daemon",...}
curl -s localhost:4661/api/config
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | Liveness + version |
| GET | `/api/config` | none | `authMode` + Supabase client config |
| GET | `/api/limits` | none | The per-user agent limits in force (same object `/api/me` returns) — what the pricing page shows — plus `prices` (`{currency, inputPerMtok, cacheWritePerMtok, cacheReadPerMtok, outputPerMtok}`, the rate card a run's cost is priced at: `CELIADOR_PRICE_{INPUT,CACHE_WRITE,CACHE_READ,OUTPUT}_PER_MTOK`, default 15 / 18.75 / 1.5 / 75 USD) |
| GET | `/api/me` | user | The signed-in account: identity, plan, today's usage vs. quota, and `tasks` (`running`, `prOpen`, `mergedLast7Days`, `costUsdLast7Days` = the cost of merged + pr-open tasks finished in the last 7 days, `concurrency`) |
| GET | `/api/tasks` | user | The agent task queue (+ concurrency, linked repos); `GET /api/tasks/stream` = live changes (SSE). Tasks carry `runner` (`mac` / `cloud`), `machine`, `startedAt`, `finishedAt`, live `activity` / `awaiting` (from the linked session), `pr` (size, checks, mergeable — refreshed from GitHub with the App, lazily when older than 60 s) and `usage` (`{requests, inputTokens, outputTokens, costUsd}` — the linked session's, see §cost in `docs/CLIENT_INTEGRATION.md`) |
| POST | `/api/tasks` | user | A task by hand: `{remoteUrl, title, details?}` or `{remoteUrl, issue: {number, title, url}, details?}` (github.com repos; an open task for the same issue is returned, `deduped: true`) |
| POST | `/api/tasks/:id/cancel` | user | Cancel a queued or running task (a cloud run's sandbox is killed) |
| POST | `/api/tasks/:id/status` | user (editor) | The editor reports `running` / `pr-open` (+`prUrl`, `pr {number, additions, deletions, changedFiles}`, `summary` = the run's final assistant message, ≤8000 chars — with the App the daemon composes the PR body from it and PATCHes it) / `merged` / `failed`, + `machine`. `running` after `pr-open` = a follow-up turn; `pr-open` may be re-sent |
| POST | `/api/tasks/:id/merge` | user | Merge the task's PR `{method?}`: as the GitHub App when installed, else relayed to the run's editor (`git.merge` with `head` = the task branch); 409 `{error}` otherwise |
| POST | `/api/tasks/:id/followup` | user | `{text}` → an `instruct` to an editor run's session (409 when there is none or the editor is offline); on a cloud run, another sandbox turn in the retained workspace (409 while it is still working, 503 when the sandbox is unavailable) |
| GET | `/api/open/task/:id`, `/api/open/queue` | none | Data-free pages that bounce to `celiador://task/<id>` / `celiador://queue` (the GitHub comment's links; scheme via `CELIADOR_APP_SCHEME`) |
| POST/DELETE | `/api/tasks/repos` | user | Link / unlink a repo whose GitHub issues become tasks (one owner per repo) |
| POST | `/api/github/webhook` | GitHub signature (`CELIADOR_GITHUB_WEBHOOK_SECRET` or the GitHub App's secret) | `issues` labelled `celiador`, or a collaborator's `@celiador` comment → a task, dispatched to the user's editor (`start-task` on the control stream) or, when no online editor has the repo and `CELIADOR_RUNNER_AGENT=sandbox`, run in the cloud (needs the App on the repo) — within `CELIADOR_TASK_CONCURRENCY` (default 3); a collaborator's comment on an issue whose task is `awaiting` → the answer / approve / deny, relayed to the run and acknowledged with a 👍; a merged `pull_request` on a task's branch → the task is `merged`; `pull_request` opened/synchronize/reopened, `check_suite`/`check_run` completed and `status` → the task's `pr` is refreshed; a `check_suite`/`check_run` that failed on a pr-open task → a fix follow-up (once per head sha, at most `CELIADOR_TASK_CI_FIX_ATTEMPTS` (default 2) per task) |
| GET | `/api/github/app/new`, `/api/github/app/setup` | none (GitHub enforces org ownership) | One-time creation of the Celiador GitHub App via GitHub's manifest flow; credentials land in `data/github-app.json`. With the app installed the daemon narrates runs on the issue (picked up, plan, questions / approvals, PR opened, checks failed, failed), writes the PR body, pushes and opens PRs for cloud runs, and clones private repos |
| POST | `/api/agent/messages` | user JWT **or** `CELIADOR_AGENT_TOKEN` | Locked Claude proxy, daemon-owned 3-tool set (SSE). `X-Celiador-Mirror: <mirrorKey>` attributes the request's tokens to that relay session's `usage` |
| POST | `/api/anthropic/v1/messages` | user JWT **or** `CELIADOR_AGENT_TOKEN` | First-party gateway: forwards caller's own system + tools; daemon keeps key/model/caps/quota (SSE). Same `X-Celiador-Mirror` attribution; a runner token's run id attributes without the header |
| GET | `/api/anthropic/v1/models` | user JWT **or** `CELIADOR_AGENT_TOKEN` | Model list (proxied) |
| POST | `/api/push/register` | user | Register an APNs device token |
| DELETE | `/api/push/register` | user | Remove a device token |
| POST | `/api/push/activity` | user | Register a Live Activity token (`activityId`) |
| POST | `/api/push/test` | user | Send a test alert to the caller's devices |
| * | `/api/sessions/*` | user | Agent-session relay (editor = runner, phone = watcher) |
| GET/PATCH | `/api/profile` | user | Profile (DB) |
| GET/PATCH/DELETE | `/api/chats`, `/api/chats/:id` | user | Durable chat history (DB) |
| DELETE | `/api/account` | user (supabase mode) | Delete the caller's account (GoTrue user + DB rows + relay/push files) |
| GET | `/api/update/:platform/:quality/:commit` | none | Editor update feed (Squirrel.Mac): 204 = up to date, else the newest build's descriptor |
| GET | `/api/releases` | none | Every published editor build (newest first) with download URLs |
| GET | `/api/releases/latest/:platform/:quality[/dmg\|/archive]` | none | Newest build descriptor, or a 302 to its DMG / update archive |
| GET/HEAD | `/api/releases/:file` | none | The artifact itself (only files `manifest.json` names) |

## Layout

```
src/
  main.ts        bootstrap + @hono/node-server listen (imports env.ts FIRST)
  env.ts         .env loader — runs before config.ts reads process.env
  app.ts         Hono app, route wiring, CORS, error handling
  config.ts      env-derived constants, version
  auth.ts        Supabase JWT verify + requireUser middleware + fail-closed guard
  anthropic.ts   agent proxy (SSE relay of the Anthropic stream)
  agent/         policy.ts (server-owned system prompt + tool allowlist), quota.ts (per-user limits), pricing.ts (the rate card)
  account/       DELETE /api/account
  sessions/      relay (bus, store, routes, notify, persist, usage = per-run cost attribution)
  data/, db/     profile + chat-history routes and Postgres access
  push/
    apns.ts      ES256 provider JWT + HTTP/2 APNs sender (dependency-free)
    store.ts     per-user device/activity token registry (data/push/<uid>.json)
    routes.ts    /api/push/* endpoints
  releases/      editor update feed + artifact downloads, read from releases/manifest.json
  tasks/         agent task queue: store, routes, dispatch (editor or cloud), github (webhook: tasks, answers, CI),
                 cloud (sandbox run → commit / push / PR as the App), followup, ci (checks-failed fixes),
                 live (session → task fields), comments + pulls (the App's issue comments, PR refresh/merge/body),
                 prBody (pure: plan + self-review parsing, PR body composition)
  runner/        cloud runs: manager, run, sandbox (Docker, no network), workspace (clone / git helper), agent
  github/        the Celiador GitHub App (manifest setup, installation tokens)
  open/          /api/open/* deep-link bounce pages
```

## Editor releases

The editor's release script (`celiador-editor/build/celiador/release-macos.sh
--publish`) rsyncs each build's update archive (`.zip`), DMG and a fresh
`manifest.json` into `CELIADOR_RELEASES_DIR` (default `<CELIADOR_HOME>/releases`).
`manifest.json` is `{ "releases": [ { platform, quality, version (commit),
productVersion, timestamp, archive, archiveSha256, dmg?, dmgSha256?, notes? } ] }`;
entries are appended, never pruned — only commits the manifest knows are offered an
update, so a local dev build is never "updated" to an older published release.
Download URLs are built on `CELIADOR_PUBLIC_URL` (default `https://celiador.ai`).

## Env

See `.env.example` (and `.env.{dev,test,prod}.example`). Auth mode is chosen
by which vars are set: `SUPABASE_JWT_SECRET` → supabase, else `CELIADOR_TOKEN` →
token, else none (loopback dev with `CELIADOR_ALLOW_NO_AUTH=1` only). Push is a
no-op unless the `APNS_*` vars are set. Cloud runs need `CELIADOR_RUNNER_AGENT=sandbox`
(+ Docker and the runner image, `docs/CLOUD_RUNS.md`) and the GitHub App installed
on the repo. The rate card is `CELIADOR_PRICE_{INPUT,CACHE_WRITE,CACHE_READ,OUTPUT}_PER_MTOK`
(USD, default 15 / 18.75 / 1.5 / 75 — cache reads are most of an agent turn's input, so they
have their own rate); the checks-failed fix cap is `CELIADOR_TASK_CI_FIX_ATTEMPTS`
(default 2). Under systemd `EnvironmentFile`, keep comments on their own lines —
inline `# …` becomes part of the value.

## Deploy (box)

Live since 2026-09-24. Three environments — dev, test, prod — each with its
own daemon instance, Postgres and GoTrue; `ENVIRONMENTS.md` is the map,
`deploy/provision-env.sh` stands a non-prod one up, `deploy/deploy.sh <env>`
ships code by hand (the Actions workflow does the same on push/tag). `tsx` is a
runtime dependency (the unit runs `npm run start` → `tsx src/main.ts`), so
`npm ci --omit=dev` works. Schema changes are `db/migrations/*.sql`, applied
forward-only by `npm run migrate`. Releases: `RELEASING.md` (`scripts/release.sh`,
the two-stage push, `.github/workflows/deploy.yml`); changes go in `CHANGELOG.md`.
