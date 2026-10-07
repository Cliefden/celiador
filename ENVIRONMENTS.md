# Celiador environments — dev / test(staging) / prod

Three isolated environments, all on the current box, separated by **port +
subdomain + systemd unit + separate auth store + separate secrets file**. The
daemon is fully env-driven (`src/config.ts`, `src/auth.ts`), so this is
configuration + process layout, not forked code.

**The invariant that must always hold:** a **dev or staging token can never
authenticate against prod.** Guaranteed by a distinct `SUPABASE_JWT_SECRET` (and
a distinct auth store) per environment.

## Topology (as built on srv1680809)

| Env | Subdomain | Daemon | systemd unit | Auth DB (in `celiador-db`) | GoTrue | Anthropic | Model |
|---|---|---|---|---|---|---|---|
| prod | `celiador.ai` | `127.0.0.1:4671` | `celiador-daemon.service` | prod DB (existing full Supabase stack via kong `:8400`) | `celiador-auth` | prod key | `claude-opus-4-8` |
| test | `staging.celiador.ai` | `127.0.0.1:4672` | `celiador-daemon@staging` | `celiador_staging` | `gotrue-staging` `:9997` | safe key | `claude-opus-4-8` |
| dev | `dev.celiador.ai` (+ laptop `:4661`) | `127.0.0.1:4673` | `celiador-daemon@dev` | `celiador_dev` | `gotrue-dev` `:9996` | cheap key | `claude-haiku-4-5` |

Prod keeps its existing full Supabase compose stack (kong/rest/storage/realtime).
Staging + dev use the **lightweight** approach: a single standalone GoTrue
container each, sharing the existing `celiador-db` Postgres via a new database,
since Celiador uses Supabase for auth only.

## On-box layout

```
~/envs/<env>/daemon/         # one checkout per env (its own ref/commit)
~/envs/<env>/daemon/.env     # per-env config+secrets (chmod 600, read by the daemon's loadDotEnv)
~/envs/<env>/secrets/        # generated JWT secret + DB role password (chmod 600)
~/envs/<env>/web/            # per-env web root (placeholder; prod web is a Next.js service on :3100)
```

Repo artifacts backing this:
- `.env.{prod,staging,dev}.example` — per-env key templates (no secrets).
- `deploy/celiador-daemon@.service` — the templated systemd unit (mirrors prod).
- `deploy/provision-env.sh <staging|dev>` — stands up DB + role + standalone
  GoTrue + daemon + unit for one env (prod untouched). Needs `CELIADOR_ANTHROPIC_KEY`.
- `deploy/deploy.sh <env>` — redeploy daemon code: rsync + `npm ci` + restart + health check.
- `deploy/Caddyfile.example` — the staging + dev vhosts (`/auth`→GoTrue, `/api`→daemon).

The editor and iOS clients have matching build channels — see
`celiador-editor/CHANNELS.md` and `celiador-ios/CHANNELS.md`.

## Auth: lightweight GoTrue per env

The shared `celiador-db` Postgres (reachable inside the `celiador_default` docker
network as `db:5432`, and from the host via the supavisor pooler `:5535`) holds a
new database per non-prod env (`celiador_staging`, `celiador_dev`). Each env runs
one standalone `supabase/gotrue` container (image matched to prod,
`v2.186.0`) on loopback (`:9997` / `:9996`), attached to `celiador_default`, with
its **own** `GOTRUE_JWT_SECRET` (== that env's daemon `SUPABASE_JWT_SECRET`).
Caddy fronts each at `<subdomain>/auth/*`. `provision-env.sh` sets all of this up.

Local dev can skip auth entirely: leave `SUPABASE_JWT_SECRET` unset and set
`CELIADOR_ALLOW_NO_AUTH=1` → `authMode=none` (single `default` user, loopback HOST
only). Without that flag the daemon **refuses to start** with no auth configured,
so a prod/staging env file that lost its secret fails closed instead of opening
every endpoint.

Each env's `.env` lives in its daemon dir and is read by the daemon's own
`loadDotEnv` (the same mechanism prod uses from `~/daemon/.env`), so no systemd
`EnvironmentFile` is needed. Per-user agent limits (`CELIADOR_AGENT_RPM`,
`…_DAILY_*`) and the optional plan gate (`CELIADOR_AGENT_PLANS`) are listed in
each `.env.<env>.example` template.

## Deploy / promotion

```
feature branch → dev (local `npm run dev`, or dev.celiador.ai)
             → merge to `staging` → ./deploy/deploy.sh staging → manual QA on staging.celiador.ai
             → merge/tag to `main`/release → ./deploy/deploy.sh prod
```

Schema/auth migrations follow the same order — **dev → staging → prod**, never
straight to prod. Editor + iOS release builds are cut from the same ref as the
prod daemon.

## First-time box setup (once)

On the box, stand up each non-prod env (prod is untouched):

```sh
cd ~/daemon/deploy
CELIADOR_ANTHROPIC_KEY=sk-ant-<safe>  ./provision-env.sh staging
CELIADOR_ANTHROPIC_KEY=sk-ant-<cheap> ./provision-env.sh dev
```

`provision-env.sh` creates the env's database + login role + extensions in
`celiador-db`, launches its standalone GoTrue, generates the JWT secret, deploys
the daemon code + `.env`, installs the templated unit, and starts
`celiador-daemon@<env>`. Then the deliberately-manual, prod-touching steps:

1. DNS: add A records for `staging.celiador.ai` and `dev.celiador.ai` → the box.
2. Caddy: merge `deploy/Caddyfile.example` vhosts (back up the live file first),
   `sudo systemctl reload caddy`.
3. (Optional, later) **Prod cutover** to the templated unit: deploy prod into
   `~/envs/prod/daemon`, then `systemctl disable --now celiador-daemon` +
   `enable --now celiador-daemon@prod`. Not required for staging/dev to work.
4. (Optional, later) Durable staging/dev profiles/chats: add a `DATABASE_URL` to
   the env `.env` using the supavisor pooler tenant DSN (`:5535`).

## Verification

- **Isolation (critical):** sign in on staging, take that JWT, call
  `https://celiador.ai/api/agent/messages` with it → must be **401**. Repeat
  dev→prod.
- **Health:** `curl https://{celiador.ai,staging.celiador.ai,dev.celiador.ai}/api/health`
  — each returns its own `{ok, version, pid}`.
- **Config:** `GET /api/config` per subdomain returns the matching `supabaseUrl`.
