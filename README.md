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
| GET | `/api/limits` | none | The per-user agent limits in force (same object `/api/me` returns) — what the pricing page shows |
| POST | `/api/agent/messages` | user JWT **or** `CELIADOR_AGENT_TOKEN` | Locked Claude proxy, daemon-owned 3-tool set (SSE) |
| POST | `/api/anthropic/v1/messages` | user JWT **or** `CELIADOR_AGENT_TOKEN` | First-party gateway: forwards caller's own system + tools; daemon keeps key/model/caps/quota (SSE) |
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
  agent/         policy.ts (server-owned system prompt + tool allowlist), quota.ts (per-user limits)
  account/       DELETE /api/account
  sessions/      relay (bus, store, routes, notify, persist)
  data/, db/     profile + chat-history routes and Postgres access
  push/
    apns.ts      ES256 provider JWT + HTTP/2 APNs sender (dependency-free)
    store.ts     per-user device/activity token registry (data/push/<uid>.json)
    routes.ts    /api/push/* endpoints
  releases/      editor update feed + artifact downloads, read from releases/manifest.json
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

See `.env.example` (and `.env.{dev,staging,prod}.example`). Auth mode is chosen
by which vars are set: `SUPABASE_JWT_SECRET` → supabase, else `CELIADOR_TOKEN` →
token, else none (loopback dev with `CELIADOR_ALLOW_NO_AUTH=1` only). Push is a
no-op unless the `APNS_*` vars are set. Under systemd `EnvironmentFile`, keep
comments on their own lines — inline `# …` becomes part of the value.

## Deploy (box)

Live since 2026-09-24. Per-environment deploys (prod/staging/dev) go through
`deploy/deploy.sh <env>` — see `ENVIRONMENTS.md`. `tsx` is a runtime dependency
(the unit runs `npm run start` → `tsx src/main.ts`), so `npm ci --omit=dev` works.
