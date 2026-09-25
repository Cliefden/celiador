# Client integration plan — macOS editor & iOS companion → daemon

How the two clients talk to the daemon (`https://celiador.ai/api/*`). Everything is
Bearer-authenticated with a Supabase JWT (see AUTH.md); the daemon holds the LLM
key and the DB connection — clients never hold either.

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

## Current state

- **Daemon**: all endpoints live; DB wired (`DATABASE_URL`), verified end-to-end.
- **macOS editor (`celiador-ai`)**: runner-side relay **DONE** — `src/relay.ts`
  (`SessionRelay`) is wired into the agent loop in `src/extension.ts` (mirrors
  delta/tool/toolResult/reply/state/done, approvals via `waitForApproval`, command
  channel for instruct/cancel/approve/reject). Auth done (`src/auth.ts`).
  **Missing**: profile + chat-history reads.
- **iOS**: greenfield. The code in `daemon-old/apps/apple` is the OLD companion for
  the retired product. Rebuild in a new `celiador-ios` repo (see the companion plan).

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

## Plan — iOS companion (`celiador-ios`, new repo)

Watcher-first (remote-control), per the locked companion decision. Port what's
reusable from `daemon-old/apps/apple/Shared` (`Api.swift` GoTrue+Keychain,
`Events.swift`, `Models.swift`, `Theme.swift`), drop the old projects/spec code.

- **I0 · Scaffold + auth.** New repo + XcodeGen project. Port `Api.swift`
  (GoTrue sign-in, Keychain, refresh, retry-on-401) and `/api/config` bootstrap.
  Base URL `https://celiador.ai`.
- **I1 · Watcher core (the point of the app).**
  - List/open sessions: `GET /api/sessions`, `GET /api/sessions/:id`.
  - Live view: subscribe `GET /api/sessions/:id/events` (SSE) with `Last-Event-ID`
    replay; render activity/delta/message/tool/diff; surface `approval`/`question`
    as actionable prompts; reflect `state`.
  - Control: `POST /api/sessions/:id/message | approvals/:rid | answers/:rid | cancel`.
- **I2 · Durable history + profile.** `GET /api/chats`, `GET /api/chats/:id` for past
  conversations; `GET/PATCH /api/profile` for the account screen.
- **I3 · Push + Live Activity.** Register APNs via `POST /api/push/register` and Live
  Activity tokens via `POST /api/push/activity`; the daemon already alerts on
  approval/question/done and drives Live Activities (`sessions/notify.ts`).
- **I4 · Widgets / Live Activity UI.** Per the companion scope (Widgets + Live
  Activity); `WidgetShared.swift` is a starting point.

Sequence: I0 → I1 (MVP: watch + steer a live run) → I3 (so it works backgrounded) →
I2 → I4.

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

1. **iOS I0 + I1** — the companion's whole reason to exist is watching/steering a run;
   the daemon + editor runner already support it, so this is the highest-value next step.
2. **iOS I3** — push, so it's useful with the app closed.
3. **Editor E1** (account) and **iOS I2** (history/profile) — quick wins on the durable layer.
4. **iOS I4** + **Editor E2** — polish.
