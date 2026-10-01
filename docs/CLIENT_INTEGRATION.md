# Client integration plan — macOS editor & iOS companion → daemon

How the two clients talk to the daemon (`https://celiador.ai/api/*`). Everything is
Bearer-authenticated with a Supabase JWT; the daemon holds the LLM key and the DB
connection — clients never hold either.

## The daemon API surface (all live in prod)

| Area | Endpoint | Who | Notes |
|---|---|---|---|
| Health/boot | `GET /api/health`, `GET /api/config` | any | config → authMode + Supabase client cfg |
| Agent | `POST /api/agent/messages` | editor | Claude proxy, SSE |
| Relay | `POST /api/sessions`, `GET /:id/events`, `GET /:id/commands`, `POST /:id/events`, `POST /:id/{message,approvals/:rid,answers/:rid,cancel}` | editor=runner, phone=watcher | live, ephemeral |
| Profile | `GET /api/profile`, `PATCH /api/profile` | both | durable |
| Chat history | `GET /api/chats`, `GET /api/chats/:id`, `PATCH/DELETE /api/chats/:id` | both | durable; rows written by the relay persister |
| Push | `POST/DELETE /api/push/register`, `POST /api/push/activity` | phone | APNs |

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
- **macOS editor (`celiador-ai`)**: runner-side relay implementation (`src/relay.ts`,
  `SessionRelay`) is in progress on a separate PR in `Cliefden/celiador-editor` and
  not yet merged to the editor's main branch. When complete, it will wire into the
  agent loop in `src/extension.ts` to mirror delta/tool/toolResult/reply/state/done,
  handle approvals via `waitForApproval`, and provide a command channel for
  instruct/cancel/approve/reject. Auth done (`src/auth.ts`).
  **Missing**: session relay completion, profile + chat-history reads.
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
