# celiador-daemon (`Cliefden/daemon`)

The **Celiador backend daemon** — the current, slim backend for the Celiador
editor (`celiador-ai`) and the iOS companion app. It does three things:

1. **Anthropic agent proxy** — `POST /api/agent/messages` streams a Claude
   response over SSE. The daemon holds the API key and picks the model; clients
   send only `system`, `tools`, and `messages`. No key ships in any client.
2. **Auth** — Supabase HS256 JWT verification (multi-user), a shared-token mode,
   or open localhost dev. Same contract as before (`SUPABASE_JWT_SECRET`, …).
3. **APNs push** — device/Live-Activity registration and an ES256-signed APNs
   sender for the iOS companion app.

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
cp .env.example .env      # add ANTHROPIC_API_KEY at minimum
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
| POST | `/api/agent/messages` | user JWT **or** `CELIADOR_AGENT_TOKEN` | Claude proxy (SSE) |
| POST | `/api/push/register` | user | Register an APNs device token |
| DELETE | `/api/push/register` | user | Remove a device token |
| POST | `/api/push/activity` | user | Register a Live Activity token (`activityId`) |
| POST | `/api/push/test` | user | Send a test alert to the caller's devices |
| POST | `/api/sessions` | user | Create an agent session (relay) |
| GET | `/api/sessions/:id/events` | user | SSE stream of session events |
| GET | `/api/sessions/:id/commands` | user | SSE stream of runner commands |
| POST | `/api/sessions/:id/events` | user | Runner publishes events |
| POST | `/api/sessions/:id/message` | user | Watcher sends instruct message |
| POST | `/api/sessions/:id/approvals/:rid` | user | Watcher approves tool use |
| POST | `/api/sessions/:id/answers/:rid` | user | Watcher answers question |
| POST | `/api/sessions/:id/cancel` | user | Watcher cancels session |
| GET | `/api/profile` | user | Get user profile |
| PATCH | `/api/profile` | user | Update profile (name, avatar, settings) |
| GET | `/api/chats` | user | List user's chat history |
| GET | `/api/chats/:id` | user | Get chat with messages |
| PATCH | `/api/chats/:id` | user | Rename a chat |
| DELETE | `/api/chats/:id` | user | Delete a chat |

## Layout

```
src/
  main.ts        bootstrap + @hono/node-server listen
  app.ts         Hono app, route wiring, CORS, error handling
  config.ts      env, version, .env loader
  auth.ts        Supabase JWT verify + requireUser middleware
  anthropic.ts   agent proxy (SSE relay of the Anthropic stream)
  push/
    apns.ts      ES256 provider JWT + HTTP/2 APNs sender (dependency-free)
    store.ts     per-user device/activity token registry (data/push/<uid>.json)
    routes.ts    /api/push/* endpoints
```

## Env

See `.env.example`. Auth mode is chosen by which vars are set:
`SUPABASE_JWT_SECRET` → supabase, else `CELIADOR_TOKEN` → token, else none
(localhost dev). Push is a no-op unless the `APNS_*` vars are set.

## Deploy (box)

Same pattern as the old daemon (systemd unit runs `npm run start` via `tsx`):

```sh
rsync -az --exclude .git --exclude node_modules <local>/daemon/ stefan@cliefden.com:daemon/
ssh stefan@cliefden.com 'cd ~/daemon && npm ci && sudo systemctl restart <unit>'
```

**Deployed** and live at `https://celiador.ai/api/*` (see `/api/health` for version).
