# Celiador environments — dev / test / prod

Three isolated environments on the one box, the way Celindor runs its own
(`Celindor/celindor/RELEASING.md`): each has its own daemon instance, its own
Postgres, its own GoTrue, its own secrets and its own host name. The daemon is
fully env-driven (`src/config.ts`, `src/auth.ts`), so an environment is
configuration + process layout, not forked code. The clients have matching build
channels: `celiador-editor/CHANNELS.md`, `celiador-ios/CHANNELS.md`.

**The invariant that must always hold:** a **dev or test token can never
authenticate against prod.** Guaranteed by a distinct `SUPABASE_JWT_SECRET` (and
a distinct GoTrue + database) per environment.

## Topology

| Env | Host | Daemon | systemd | Postgres | GoTrue | Web | Anthropic | Deployed by |
|---|---|---|---|---|---|---|---|---|
| **prod** | `celiador.ai` | `127.0.0.1:4671` | `celiador-daemon` (→ `celiador-daemon@prod` after the cutover) | the full Supabase stack (`celiador-db` via the pooler `:5535`) | `celiador-auth` behind kong `:8400` | `celiador-web` `:3100` | prod key, `claude-opus-4-8` | manual dispatch, required reviewer |
| **test** | `test.celiador.ai` | `127.0.0.1:4672` | `celiador-daemon@test` | `celiador-test` compose, `:5433` | standalone, `:9997` | `celiador-web@test` `:3102` (noindex) | safe key, `claude-opus-4-8` | every `vX.Y.Z` tag |
| **dev** | `dev.celiador.ai` | `127.0.0.1:4673` | `celiador-daemon@dev` | `celiador-dev` compose, `:5434` | standalone, `:9996` | `celiador-web@dev` `:3103` (noindex) | cheap key, `claude-haiku-4-5` | every push to `main` |
| **local** | `localhost:4661` | `npm run dev` (`wb dev`) | — | optional | none (`CELIADOR_ALLOW_NO_AUTH=1`) | `npm run dev` `:3000` | your key | you |

Every port binds to loopback; Caddy is the only public entry and routes by host
name (`deploy/Caddyfile.example`): `/auth/v1/*` → that env's GoTrue (prefix
stripped, as kong does for prod), `/api/*` + `/p/*` → that env's daemon, `/` →
that env's web preview. DNS A records for `dev.` and `test.` exist since
2026-10-28.

## On-box layout

```
~/envs/<env>/compose.env       the compose stack's settings + secrets (600)
~/envs/<env>/deploy/           a copy of deploy/ (compose.yml, db/roles.sql)
~/envs/<env>/secrets/          generated: jwt, dbpw, anon (600)
~/envs/<env>/daemon/           the daemon checkout for this env + its .env + BUILD_INFO
~/envs/<env>/web/              the marketing-site checkout for this env (celiador-web)
```

Repo artifacts backing this:

- `.env.{prod,test,dev}.example` — per-env key templates (no secrets).
- `deploy/compose.yml` + `deploy/db/roles.sql` — one non-prod env's Postgres
  (`supabase/postgres`, the prod image family, so `auth.uid()` and the service
  roles exist) and standalone GoTrue.
- `deploy/provision-env.sh <test|dev>` — stands up or refreshes one env: secrets,
  compose stack, daemon checkout + `.env` + `BUILD_INFO`, migrations, unit.
  Idempotent; prod untouched.
- `deploy/celiador-daemon@.service` — the templated unit (`%i` = env).
- `deploy/deploy.sh <env>` — ship code by hand: rsync + `npm ci` + migrate +
  restart + health gate.
- `deploy/Caddyfile.example` — the test + dev vhosts.
- `src/db/migrate.ts` (`npm run migrate`) — forward-only migrations, tracked in
  `public.schema_migrations`.

## Auth and data per environment

Prod keeps its existing full Supabase compose stack (`~/supabase-celiador`).
Test and dev each run **one Postgres + one GoTrue container** as the compose
project `celiador-<env>`; the daemon (a host systemd service) connects to its
env's Postgres on the loopback port as the `postgres` role, as it does on prod
through the pooler. A migration run on dev lands only in dev; `docker compose -p
celiador-dev down -v` resets dev entirely.

Each env's GoTrue has its **own** `GOTRUE_JWT_SECRET` (== that env's daemon
`SUPABASE_JWT_SECRET`), its own `SITE_URL`, and a redirect allowlist holding only
that env's deep-link schemes:

| Env | `GOTRUE_URI_ALLOW_LIST` | Why |
|---|---|---|
| prod | `celiador://*` (+ the editor's `celiador://celiador.celiador-ai/auth-callback`) | the App Store app and the prod editor |
| test | `celiador://*,celiador-test://*` | the test app is the prod bundle (TestFlight, pointed at test); the test editor is `celiador-test` |
| dev | `celiador-dev://*` | the dev app and the dev editor |

The anon key `/api/config` hands the clients is a long-lived HS256 JWT with
`role: anon`, minted from the env's secret by `provision-env.sh`. Magic-link
mail goes through Migadu (`CELIADOR_SMTP_PASS` at provision time); GitHub
sign-in needs a GitHub OAuth app per env and is off on test and dev until one
exists.

Local dev can skip auth entirely: leave `SUPABASE_JWT_SECRET` unset and set
`CELIADOR_ALLOW_NO_AUTH=1` → `authMode=none` (single `default` user, loopback
HOST only). Without that flag the daemon **refuses to start** with no auth
configured, so a prod/test env file that lost its secret fails closed.

Each env's `.env` lives in its daemon dir and is read by the daemon's own
`loadDotEnv`, so no systemd `EnvironmentFile` is needed. `CELIADOR_ENV` names
the environment; `/api/health` reports it with the deployed `commit` (from
`BUILD_INFO`), which the deploy scripts verify before declaring success.

## Migrations

`db/migrations/NNNN_name.sql`, forward-only, applied in filename order by
`npm run migrate`, each file once, recorded by name in
`public.schema_migrations`. Never edit an applied file; add a new one. Rolling
back code never rolls back the schema. Order of application is always **dev →
test → prod**: a push to `main` migrates dev, a tag migrates test, prod
migrates when its deploy says `migrate=true`. Prod's `0001` and `0002` were
applied by hand before the runner existed: record them once with
`npm run migrate -- --baseline` before the first prod deploy through the
pipeline.

## Deploy / promotion

```
feature branch → PR → merge to main   → dev   (automatic: deploy.yml, with migrations)
scripts/release.sh patch|minor|major  → tag vX.Y.Z → push → test (automatic, with migrations)
Actions → Deploy → env=prod tag=vX.Y.Z → prod  (manual, required reviewer)
```

The daemon is the release train: its `vX.Y.Z` tags are the Celiador releases
and name what test and prod run. Rollback is a redeploy of the previous tag.
Editor and iOS builds follow the same triggers in their own repos (`main` →
dev channel, tag → test channel, manual → prod). Until the workflow exists
(issue #42), `deploy/deploy.sh <env>` does the same steps from a laptop.

## First-time box setup (once)

On the box, as `stefan`, from a copy of the daemon checkout to deploy
(`rsync` it to e.g. `~/daemon-main` first; the box has no GitHub credentials):

```sh
cd ~/daemon-main/deploy
CELIADOR_ANTHROPIC_KEY=sk-ant-<safe>  CELIADOR_SMTP_PASS=<migadu> ./provision-env.sh test
CELIADOR_ANTHROPIC_KEY=sk-ant-<cheap> CELIADOR_SMTP_PASS=<migadu> ./provision-env.sh dev
```

Then the deliberately manual, prod-touching steps:

1. Caddy: merge `deploy/Caddyfile.example` into `/etc/caddy/Caddyfile` (back the
   live file up first), `sudo caddy validate --config /etc/caddy/Caddyfile`,
   `sudo systemctl reload caddy`.
2. Web previews: `celiador-web@test` / `@dev` from the `celiador-web` repo
   (its `deploy/`), on `:3102` / `:3103`.
3. APNs: add the team key (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_PATH`) to
   each env's `.env` to enable push there.

### Prod cutover

After test and dev have both deployed through the pipeline once:

```sh
# on the box
rsync -a --exclude node_modules ~/daemon/ ~/envs/prod/daemon/      # code + data + .env + releases
sed -i 's|^CELIADOR_HOME=.*|CELIADOR_HOME=/home/stefan/envs/prod/daemon|' ~/envs/prod/daemon/.env
grep -q '^CELIADOR_ENV=' ~/envs/prod/daemon/.env || echo 'CELIADOR_ENV=prod' >> ~/envs/prod/daemon/.env
cd ~/envs/prod/daemon && npm ci --omit=dev && npm run migrate -- --baseline
sudo systemctl disable --now celiador-daemon && sudo systemctl enable --now celiador-daemon@prod
curl -s https://celiador.ai/api/health          # env=prod, same :4671, Caddy unchanged
```

Rollback: `systemctl disable --now celiador-daemon@prod && systemctl enable --now celiador-daemon`.
Keep `~/daemon` until prod has deployed through the workflow twice.

## Verification

- **Isolation (critical):** sign in on test, take that JWT, call
  `https://celiador.ai/api/me` with it → must be **401**. Repeat dev → prod and
  test ↔ dev.
- **Health:** `curl https://{celiador.ai,test.celiador.ai,dev.celiador.ai}/api/health`
  — each returns its own `env`, `commit`, `version`, `pid`.
- **Config:** `GET /api/config` per host returns the matching `supabaseUrl` and
  an anon key that verifies against that env's secret.
- **Mail:** `POST https://test.celiador.ai/auth/v1/otp` with the anon `apikey`
  and `{"email":…,"create_user":true}` → 200 and a magic link in the inbox.
