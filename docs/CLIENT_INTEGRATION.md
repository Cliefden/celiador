# Client integration plan — macOS editor & iOS companion → daemon

How the two clients talk to the daemon (`https://celiador.ai/api/*`). Everything is
Bearer-authenticated with a Supabase JWT (see AUTH.md); the daemon holds the LLM
key and the DB connection — clients never hold either.

## The daemon API surface (all live in prod)

| Area | Endpoint | Who | Notes |
|---|---|---|---|
| Health/boot | `GET /api/health`, `GET /api/config` | any | config → authMode + Supabase client cfg |
| Agent | `POST /api/agent/messages` | editor | Claude proxy, SSE. Server-owned system prompt + tools; client sends `messages` only; per-user quota (429 + Retry-After) |
| Relay | `POST /api/sessions`, `GET /:id/events`, `GET /:id/commands`, `POST /:id/events`, `POST /:id/{message,approvals/:rid,answers/:rid,cancel}` | editor=runner, phone=watcher | live, ephemeral |
| Profile | `GET /api/profile`, `PATCH /api/profile` | both | durable |
| Chat history | `GET /api/chats`, `GET /api/chats/:id`, `PATCH/DELETE /api/chats/:id` | both | durable; rows written by the relay persister |
| Push | `POST/DELETE /api/push/register`, `POST /api/push/activity` | phone | APNs |
| Account | `DELETE /api/account` | phone (editor later) | permanent account deletion (App Store 5.1.1(v)) |
| Tasks | `GET /api/tasks` (+ `/stream` SSE `task` events), `POST /api/tasks`, `POST /:id/{cancel,status,merge,followup}` | phone + editor | the agent queue; see "Agents UI" below |
| Deep links | `GET /api/open/task/:id`, `GET /api/open/queue` | browser (no auth) | bounce pages → `celiador://task/<id>`, `celiador://queue` |

## Agents UI (tasks)

The phone's Queue / One-run screens and the editor's Agents view read tasks from
`GET /api/tasks` (`{ tasks, concurrency, repos }`) and live `task` events on
`GET /api/tasks/stream`. On top of the original fields (`id, repo, issue?, title,
prompt, branch, source, state, sessionId?, prUrl?, error?, createdAt, updatedAt`)
a task may carry — all optional, old tasks lack them:

| Field | Meaning |
|---|---|
| `runner` | `"mac"` (an editor took it at dispatch) or `"cloud"` |
| `machine` | the editor's computer name as it reported it ("Stefan's MacBook Pro") |
| `startedAt` / `finishedAt` | first `running`; reaching pr-open / failed / merged / cancelled (cleared when a follow-up turn runs again) |
| `activity` | latest one-line activity of the linked session (≤200 chars, in memory, published at most every 2 s); gone when the run isn't running |
| `awaiting` | `{ kind: "permission" \| "question", requestId, text, preview?, choices? }` while the linked session waits on the user; answer with the session's `approvals/:requestId` / `answers/:requestId` endpoints |
| `pr` | `{ number, url, additions?, deletions?, changedFiles?, checks?, mergeable?, updatedAt }`; `checks` = passing / failing / pending / none / unknown (unknown without the GitHub App or its checks permission) |

Buckets: **Needs you** = `awaiting` present · **Ready to merge** = `pr-open` ·
**Running** = queued / dispatched / running without `awaiting` · **Merged today** =
`merged` with `finishedAt` today.

Editor → daemon, `POST /api/tasks/:id/status`:
`{ state: "running" | "pr-open" | "merged" | "failed", sessionId?, prUrl?, error?, machine?, pr?: { number, additions, deletions, changedFiles } }`.
Invalid `machine` / `pr` values are dropped, not rejected. `pr-open` may be re-sent
(idempotent; needs a `prUrl` only the first time) and `running` may follow it.
A task already `merged` answers 409 to anything but `merged`.

Other calls:

- `POST /api/tasks` with `issue: { number, title, url }` (url = `https://github.com/<same owner>/<same repo>/issues/<number>`) — the editor's "Run an issue…" picker; `details` = the issue body. An open task for that issue comes back as `200 { task, deduped: true }`.
- `POST /api/tasks/:id/merge` `{ method?: "merge" | "squash" | "rebase" }` → `{ ok, merged: true, sha?, url }` or 409 `{ error }`. Needs `pr-open`. The daemon merges as the GitHub App when it is installed on the repo; otherwise it relays `git.merge` with `head: <task branch>` to the run's editor session (the editor merges the open PR for that branch); with neither: 409 "editor offline and the GitHub App isn't installed on this repo".
- `POST /api/tasks/:id/followup` `{ text }` → `{ ok: true }`: logged as the user's turn and relayed as `instruct` to the task's linked session; 409 when the task has no session or the editor is offline.

With the GitHub App on the repo the daemon posts the issue comments itself — the
"Picked up" comment when the editor first reports `running` (it names `machine`),
"Pull request opened: <url>" on the first `pr-open` — and `start-task` says
`commented: true`, so the editor skips its own comment. Without the App the editor
posts the same "Picked up" text.

Two layers, already wired end-to-end on the daemon: **relay = live**, **Supabase = durable**.
As the editor (runner) publishes to `/api/sessions/:id/events`, the daemon fans out
to watchers AND persists turns into `chats`/`messages`. So chat history fills itself
in — no extra write path needed from clients.

> **Update 2026-09-25:** profile + chat-history are now WIRED in both clients
> (editor `celiador.account`/`celiador.pastChats` + `src/api.ts`; iOS Account/History
> screens + `Api` methods). Editor compiles, iOS builds on simulator. Committed
> locally, not yet pushed. Remaining: live cross-process E2E + push registration
> check, then commit/push + ship.

## Current state

- **Daemon**: all endpoints live; DB wired (`DATABASE_URL`), verified end-to-end.
- **macOS editor (`celiador-ai`)**: runner-side relay **DONE** — `src/relay.ts`
  (`SessionRelay`) is wired into the agent loop in `src/extension.ts` (mirrors
  delta/tool/toolResult/reply/state/done, approvals via `waitForApproval`, command
  channel for instruct/cancel/approve/reject). Auth done (`src/auth.ts`).
  **Missing**: profile + chat-history reads.
- **iOS (`celiador-ios`)**: rebuilt as a watcher and **builds on simulator**. Has
  auth, session list/open, live transcript view with approve/instruct/cancel, and
  Live Activity + widget on sessions (`Shared/Api.swift`, `Events.swift`, `Models.swift`,
  `SessionsView`/`SessionView`). NOT done: profile + chat-history screens, full
  cross-process live E2E, git commit, and TestFlight/device deploy. (The old
  `daemon-old/apps/apple` companion is retired.)

## Plan — macOS editor (`celiador-ai`)

Runner relay is done, so this is small:

- **E1 · Account/profile.** On sign-in, `GET /api/profile`; show the account (name,
  plan) in the existing account status-bar item. Persist editor-side prefs via
  `PATCH /api/profile { settings }` (keep it small; settings is a jsonb blob).
- **E2 · Chat history (optional, nice-to-have).** A "Past chats" view: `GET /api/chats`
  → list; `GET /api/chats/:id` → rehydrate a conversation into the chat webview.
  Because the relay already persists, this is pure read. Wire "resume" to attach the
  runner to an existing `session_id` if `status = active`.
- **E3 · Token refresh.** Confirm the agent/relay/data calls all refresh once on
  `401` (the agent call already does; reuse that helper for the data calls).

Effort: E1 small, E2 medium, E3 tiny. No daemon changes.

## Plan — iOS companion (`celiador-ios`)

Watcher-first (remote-control). **I0/I1/I4 largely built** (auth, session list/open,
live transcript + approve/instruct/cancel, Live Activity + widget). Remaining:

- **I2 · Durable history + profile (NEXT).** Add screens backed by the new endpoints:
  `GET /api/chats` (past conversations), `GET /api/chats/:id` (open one), and
  `GET/PATCH /api/profile` (account). These are the pieces today's daemon work unlocked.
- **I3 · Push registration wiring.** Confirm the app registers APNs via
  `POST /api/push/register` and Live Activity tokens via `POST /api/push/activity`;
  the daemon already alerts on approval/question/done and drives Live Activities
  (`sessions/notify.ts`).
- **Harden · Live E2E + ship.** Full cross-process test (editor runs a task → phone
  watches/steers it live, backgrounded); handle token refresh on `401`; **commit the
  repo** (currently git-init'd, uncommitted) and push; then TestFlight/device deploy.

## Shared conventions

- **Base URL**: `https://celiador.ai` (prod). `GET /api/config` first for auth cfg.
- **Auth**: `Authorization: Bearer <supabase access_token>`; refresh within ~60s of
  expiry and retry once on `401`.
- **SSE**: send `Last-Event-ID` (or `?cursor=`) to resume the event log without gaps;
  expect periodic `ping` comments.
- **Errors**: endpoints return `{ error }` with a proper status; `503
  {"error":"database not configured"}` means the daemon has no DB (won't happen in
  prod, but handle it).

## Suggested order of work

The relay path (editor runner ↔ daemon ↔ iOS watcher) is already built on all three
sides, so the highest-value next step is proving and shipping it, then filling the
durable layer:

1. **iOS live E2E + commit** — verify editor-runs → phone-watches/steers end-to-end
   (backgrounded), confirm push registration, then commit `celiador-ios` and push.
2. **iOS I2 + Editor E1** — history/profile screens on both, using the new
   `/api/chats` + `/api/profile` endpoints (the durable layer this pass unlocked).
3. **Ship** — iOS to TestFlight/device; Editor E2 (past-chats view) as polish.
