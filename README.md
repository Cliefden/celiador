# celiador-daemon (`Cliefden/daemon`)

The **Celiador backend daemon** — the current, slim backend for the Celiador
editor (`celiador-ai`) and the iOS companion app. It does three things:

1. **Anthropic agent proxy** — `POST /api/agent/messages` streams a Claude
   response over SSE. The daemon holds the API key and owns the request shape:
   model, `max_tokens` cap, system prompt and tool allowlist are server-side
   (`src/agent/policy.ts`); clients send only `messages` (validated). Every
   caller is rate-limited and budgeted per user per day (`src/agent/quota.ts`),
   optionally gated by plan (`CELIADOR_AGENT_PLANS`). No key ships in any client.
2. **Auth** — Supabase HS256 JWT verification (multi-user), a shared-token mode,
   or open localhost dev (only with `CELIADOR_ALLOW_NO_AUTH=1` on a loopback
   HOST — otherwise the daemon refuses to start without auth configured).
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
| POST | `/api/agent/messages` | user JWT **or** `CELIADOR_AGENT_TOKEN` | Claude proxy (SSE) |
| POST | `/api/push/register` | user | Register an APNs device token |
| DELETE | `/api/push/register` | user | Remove a device token |
| POST | `/api/push/activity` | user | Register a Live Activity token (`activityId`) |
| POST | `/api/push/test` | user | Send a test alert to the caller's devices |
| * | `/api/sessions/*` | user | Agent-session relay (editor = runner, phone = watcher) |
| GET/PATCH | `/api/profile` | user | Profile (DB) |
| GET/PATCH/DELETE | `/api/chats`, `/api/chats/:id` | user | Durable chat history (DB) |
| DELETE | `/api/account` | user (supabase mode) | Delete the caller's account (GoTrue user + DB rows + relay/push files) |

## Layout

```
src/
  main.ts        bootstrap + @hono/node-server listen (imports env.ts FIRST)
  env.ts         .env loader — runs before config.ts reads process.env
  app.ts         Hono app, route wiring, CORS, error handling
  config.ts      env-derived constants, version
  auth.ts        Supabase JWT verify + requireUser middleware + fail-closed guard
  anthropic.ts   agent proxy (SSE relay of the Anthropic stream)
  agent/         policy.ts (server-owned system prompt + tool allowlist), quota.ts (per-user limits)
  account/       DELETE /api/account
  sessions/      relay (bus, store, routes, notify, persist)
  data/, db/     profile + chat-history routes and Postgres access
  push/
    apns.ts      ES256 provider JWT + HTTP/2 APNs sender (dependency-free)
    store.ts     per-user device/activity token registry (data/push/<uid>.json)
    routes.ts    /api/push/* endpoints
```

## Env

See `.env.example` (and `.env.{dev,staging,prod}.example`). Auth mode is chosen
by which vars are set: `SUPABASE_JWT_SECRET` → supabase, else `CELIADOR_TOKEN` →
token, else none (loopback dev with `CELIADOR_ALLOW_NO_AUTH=1` only). Push is a
no-op unless the `APNS_*` vars are set. Under systemd `EnvironmentFile`, keep
comments on their own lines — inline `# …` becomes part of the value.

## Deploy (box)

Live since 2026-09-24. Per-environment deploys (prod/staging/dev) go through
`deploy/deploy.sh <env>` — see `ENVIRONMENTS.md`. `tsx` is a runtime dependency
(the unit runs `npm run start` → `tsx src/main.ts`), so `npm ci --omit=dev` works.
