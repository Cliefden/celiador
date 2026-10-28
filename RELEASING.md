# Releasing Celiador

The daemon is the **release train**: its `vX.Y.Z` tags are the Celiador
releases, and they name what the test and prod environments run
(`ENVIRONMENTS.md`). The editor and the iOS app have their own version numbers
(VS Code's, and a numeric App Store one) and follow the same triggers in their
own repos: `main` → dev channel, a daemon release tag → test channel, manual →
prod.

## What the number means

Below 1.0.0 the usual 0.x convention applies: a **breaking** client-facing
change (`docs/CLIENT_INTEGRATION.md` — an endpoint, field or event removed or
renamed, a changed meaning, a new required request field) is a **MINOR** bump;
additive changes and fixes are **PATCH** releases. Going to 1.0.0 is a
deliberate decision.

Record user-visible changes under `## [Unreleased]` in `CHANGELOG.md` as they
merge. A release that touches nothing user-visible still rolls the section.

## Cutting a release

```bash
scripts/release.sh patch        # or minor | major | an exact 0.3.0
```

The script refuses unless `main` is clean and equal to `origin/main` and the
tag does not exist yet. It bumps `package.json` + `package-lock.json`, rolls
`CHANGELOG.md`, commits `Release vX.Y.Z` and creates an annotated tag. It
**never pushes**. Then, in two stages:

```bash
git push origin main      # deploys dev — wait for the run to go green
git push origin vX.Y.Z    # deploys test
```

Never `--follow-tags`: both deploys would run at once on the same box. The tag
deploy checks that the tag is on `main` and matches `package.json`.

## Environments

| Environment | Deployed by | Host |
| --- | --- | --- |
| dev | every push to `main` (with migrations) | dev.celiador.ai |
| test | a `vX.Y.Z` tag (with migrations) | test.celiador.ai |
| prod | manual dispatch only, behind the `prod` Environment's required reviewer; refused until the repository variable `PROD_ENABLED` is `true` (the prod cutover, `ENVIRONMENTS.md`) | celiador.ai |

Rollback is a redeploy of the previous tag, or `deploy/deploy.sh <env>` from a
checkout of it.

## Manual deploys

```bash
gh workflow run deploy.yml -R Cliefden/daemon --ref v0.2.0 -f env=test            # roll test back to a release
gh workflow run deploy.yml -R Cliefden/daemon --ref v0.2.0 -f env=prod -f migrate=true   # prod (asks the reviewer)
gh workflow run deploy.yml -R Cliefden/daemon --ref main   -f env=dev             # redeploy dev from main
gh run watch -R Cliefden/daemon "$(gh run list -R Cliefden/daemon -w Deploy -L 1 --json databaseId -q '.[0].databaseId')"
```

Or in GitHub: **Actions → Deploy → Run workflow**, choosing the tag or branch
under *Use workflow from*.

| Input | Default | Meaning |
| --- | --- | --- |
| `env` | `dev` | Which environment. `prod` needs `PROD_ENABLED=true`. |
| `migrate` | `false` | Apply `db/migrations` before restarting. Pushes to `main` and release tags always migrate; a manual run only when asked. |

Only one deploy per environment runs at a time; a second one waits.
Migrations only go forward, so rolling back code leaves the schema as it is.

## What the workflows do

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | pull requests, pushes to other branches, and from Deploy | `npm run typecheck` + `npm run smoke` on Node 20 and 22 |
| `deploy.yml` | `main` pushes, `vX.Y.Z` tags, manual runs | CI, then rsync the checkout to `~/envs/<env>/daemon`, `npm ci`, `BUILD_INFO`, migrate, restart `celiador-daemon@<env>`, and a health gate: `/api/health` through Caddy must report this `env` and this `commit`. Mails the result. |

Secrets stay on the box (`~/envs/<env>/daemon/.env`, written by
`deploy/provision-env.sh`); the workflow never writes them. This differs from
Celindor, which renders its secrets file from GitHub on every deploy — here the
JWT secret, the database password and the anon key are generated on the box.

## One-time setup

1. **GitHub Environments** `dev`, `test`, `prod` on `Cliefden/daemon` (done
   2026-10-28; `prod` has Cliefden as required reviewer). Each holds:

   | Secret | Value |
   | --- | --- |
   | `VPS_HOST` | `cliefden.com` |
   | `VPS_USER` | `stefan` |
   | `VPS_SSH_KEY` | the deploy key's private half (ed25519, generated 2026-10-28) |

2. **The deploy key on the box.** Append its public half to
   `~stefan/.ssh/authorized_keys`:

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOCQw1SlWoOSIMRs2Vs9hbUHXrU5/OTXa0DvmysLrjDK celiador-deploy@github-actions
   ```

   The deploy needs passwordless `sudo systemctl restart celiador-daemon@<env>`
   (and `celiador-web@<env>` for the site), which `stefan` already has.
   Rotate: `ssh-keygen -t ed25519 -C celiador-deploy@github-actions`, replace
   `VPS_SSH_KEY` in every Environment of both repos, swap the line in
   `authorized_keys`.

3. **Mail.** Repository secrets `SMTP_USER` (`stefan@celiador.ai`) and
   `SMTP_PASS` (its Migadu password); optional repository variables
   `NOTIFY_TO` (default `stefan@celiador.ai`) and `NOTIFY_SUCCESS=false` once
   only failures should mail. Without the secrets, results only show in GitHub
   (and GitHub mails the actor on failed runs anyway).

4. **Prod.** After the cutover to `celiador-daemon@prod` (`ENVIRONMENTS.md`):
   `gh variable set PROD_ENABLED --body true -R Cliefden/daemon`.

`main` is not protected: `scripts/release.sh` commits to it directly, and a
push to it deploys dev, as on Celindor. Feature work goes through pull
requests (the issue → run → PR loop), releases through the script.
