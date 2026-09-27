# Celiador environments — dev / test(staging) / prod

Three isolated environments, all on the current box, separated by **port +
subdomain + systemd unit + separate auth store + separate secrets file**. The
daemon is fully env-driven (`src/config.ts`, `src/auth.ts`), so this is
configuration + process layout, not forked code.

**The invariant that must always hold:** a **dev or staging token can never
authenticate against prod.** Guaranteed by a distinct `SUPABASE_JWT_SECRET` (and
a distinct auth store) per environment.

## Topology

| Env | Subdomain | Daemon | systemd instance | Auth DB | GoTrue | Anthropic | Model |
|---|---|---|---|---|---|---|---|
| prod | `celiador.ai` | `127.0.0.1:4671` | `celiador-daemon@prod` | `celiador_prod` | `:9998` | prod key | `claude-opus-4-8` |
| test | `staging.celiador.ai` | `127.0.0.1:4672` | `celiador-daemon@staging` | `celiador_staging` | `:9997` | safe key | `claude-opus-4-8` |
| dev | `dev.celiador.ai` (+ laptop `:4661`) | `127.0.0.1:4673` | `celiador-daemon@dev` | `celiador_dev` / none | `:9996` | cheap key | `claude-haiku-4-5` |

## On-box layout

```
~/envs/<env>/daemon/       # one checkout per env (its own ref/commit)
~/envs/<env>/daemon.env    # secrets, chmod 600, loaded by systemd EnvironmentFile
~/envs/<env>/web/          # static web root for that env
```

Repo artifacts backing this:
- `.env.{prod,staging,dev}.example` — per-env key templates (no secrets).
- `deploy/celiador-daemon@.service` — the templated systemd unit.
- `deploy/deploy.sh <env>` — rsync + `npm ci` + restart + health check.
- `deploy/Caddyfile.example` — the 3 host vhosts (api + auth + static).

## Auth: GoTrue per environment

One Postgres server (already on the box, `:5535`), three databases
`celiador_{prod,staging,dev}`, and **three GoTrue instances** — one per env, each
with its own `GOTRUE_JWT_SECRET` (== that env's daemon `SUPABASE_JWT_SECRET`) and
its own DB. GoTrue is light, so three instances is far cheaper than three full
Supabase compose stacks. Caddy fronts each at `<subdomain>/auth/v1/*`.

Local dev can skip auth entirely: leave `SUPABASE_JWT_SECRET` unset and set
`CELIADOR_ALLOW_NO_AUTH=1` → `authMode=none` (single `default` user, loopback HOST
only). Without that flag the daemon **refuses to start** with no auth configured,
so a prod/staging env file that lost its secret fails closed instead of opening
every endpoint.

Env files are read by systemd `EnvironmentFile`, which does **not** strip inline
`# comments` — keep comments on their own lines (the templates do). Per-user agent
limits (`CELIADOR_AGENT_RPM`, `…_DAILY_*`) and the optional plan gate
(`CELIADOR_AGENT_PLANS`) are listed in each template.

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

1. DNS: add A records for `staging.celiador.ai` and `dev.celiador.ai`.
2. Postgres: `CREATE DATABASE celiador_staging; CREATE DATABASE celiador_dev;`
   (prod keeps the existing DB — segregate/rename as `celiador_prod`).
3. GoTrue: stand up staging (`:9997`) and dev (`:9996`) instances, each pointed
   at its DB with a fresh `GOTRUE_JWT_SECRET`.
4. Create `~/envs/<env>/{daemon,web}` and `~/envs/<env>/daemon.env` (chmod 600)
   from the matching `.env.<env>.example`, with real secrets.
5. Install the unit: `sudo cp deploy/celiador-daemon@.service /etc/systemd/system/`
   → `daemon-reload` → `enable --now celiador-daemon@{prod,staging,dev}`.
   (Convert the current single `celiador-daemon` unit to `@prod`.)
6. Caddy: merge `deploy/Caddyfile.example` vhosts (back up the live file first),
   `caddy reload`.

## Verification

- **Isolation (critical):** sign in on staging, take that JWT, call
  `https://celiador.ai/api/agent/messages` with it → must be **401**. Repeat
  dev→prod.
- **Health:** `curl https://{celiador.ai,staging.celiador.ai,dev.celiador.ai}/api/health`
  — each returns its own `{ok, version, pid}`.
- **Config:** `GET /api/config` per subdomain returns the matching `supabaseUrl`.
