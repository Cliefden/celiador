# Releasing Celiador

This repository is the **release train**: a `vX.Y.Z` tag is a Celiador release
and names what the test and prod environments run (`ENVIRONMENTS.md`). One
version covers the daemon (`daemon/package.json`) and the iOS app
(`ios/project.yml`, `MARKETING_VERSION`); the site has no version of its own and
ships with the tag. The editor has VS Code's version and its own repo, with
matching channels: a nightly build of its `main` → dev, a release tag here →
a test build of its `main` (`editor-test-build.yml` below), manual → prod.

## What the number means

Below 1.0.0 the usual 0.x convention applies: a **breaking** client-facing
change (`daemon/docs/CLIENT_INTEGRATION.md` — an endpoint, field or event removed or
renamed, a changed meaning, a new required request field) is a **MINOR** bump;
additive changes and fixes are **PATCH** releases. Going to 1.0.0 is a
deliberate decision. `scripts/release.sh` enforces the API half of this: when
`packages/client/openapi.yaml` has a breaking change since the last tag
(oasdiff), it refuses a PATCH bump (`packages/client/README.md`).

Record user-visible changes under `## [Unreleased]` in `CHANGELOG.md` as they
merge. A release that touches nothing user-visible still rolls the section.

## Cutting a release

```bash
scripts/release.sh patch        # or minor | major | an exact 0.3.0
```

The script refuses unless `main` is clean and equal to `origin/main` and the
tag does not exist yet, and the daemon and the app agree on the current version.
It bumps `daemon/package.json` + `package-lock.json` and every
`MARKETING_VERSION` in `ios/project.yml`, rolls `CHANGELOG.md`, commits
`Release vX.Y.Z` and creates an annotated tag. It **never pushes**. Then, in
two stages:

```bash
git push origin main      # daemon → dev; the Dev app builds — wait for green
git push origin vX.Y.Z    # daemon + web → test; the iOS Test build → TestFlight;
                          # the editor's test build (Celiador Test, labelled vX.Y.Z)
```

Never `--follow-tags`: both deploys would run at once on the same box. The tag
deploy checks that the tag is on `main` and matches `daemon/package.json`.
Pushes to `main` only deploy what they touch (`daemon/**` → the daemon,
`web/**` → the site, `ios/` → the Dev app); a tag deploys everything. The
release commit touches `daemon/` and `ios/` but not `web/`, so pushing it does
**not** redeploy the site to dev: dev already runs the latest `web/` from the
pushes that changed it (dispatch `web-deploy.yml` with `env=dev` to redeploy it
anyway).

## Environments

| Environment | Deployed by | Host |
| --- | --- | --- |
| dev | every push to `main` (with migrations) | dev.celiador.ai |
| test | a `vX.Y.Z` tag (with migrations) | test.celiador.ai |
| prod | manual dispatch only, behind the `prod` Environment's required reviewer; refused until the repository variable `PROD_ENABLED` is `true` (the prod cutover, `ENVIRONMENTS.md`) | celiador.ai |

Rollback is a redeploy of the previous tag, or `daemon/deploy/deploy.sh <env>`
from a checkout of it.

## Manual deploys

```bash
gh workflow run deploy.yml -R Cliefden/celiador --ref v0.2.0 -f env=test            # roll test back to a release
gh workflow run deploy.yml -R Cliefden/celiador --ref v0.2.0 -f env=prod -f migrate=true   # prod (asks the reviewer)
gh workflow run deploy.yml -R Cliefden/celiador --ref main   -f env=dev             # redeploy dev from main
gh run watch -R Cliefden/celiador "$(gh run list -R Cliefden/celiador -w Deploy -L 1 --json databaseId -q '.[0].databaseId')"
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
| `ci.yml` | pull requests and pushes to other branches touching `daemon/`, and from Deploy daemon | `npm run typecheck` + `npm run smoke` in `daemon/` on Node 20 and 22 |
| `deploy.yml` (Deploy daemon) | `main` pushes touching `daemon/`, `vX.Y.Z` tags, manual runs | CI, then rsync `daemon/` to `~/envs/<env>/daemon`, `npm ci`, `BUILD_INFO`, migrate, restart `celiador-daemon@<env>`, and a health gate: `/api/health` through Caddy must report this `env` and this `commit`. Mails the result. |
| `web-deploy.yml` (Deploy web) | `main` pushes touching `web/`, `vX.Y.Z` tags, manual runs | `next build`, rsync `web/` + `.next` to `~/envs/<env>/web`, `npm ci`, restart `celiador-web@<env>`, check the page through the public host. Mails the result. |
| `ios.yml` (Build iOS) | `main` pushes touching `ios/`, `vX.Y.Z` tags, manual runs | On a macOS runner: XcodeGen, icon banner, `xcodebuild archive` of the channel's scheme with **manual** signing (a CI-only Apple Distribution certificate from the repository secrets and the channel's two App Store profiles, fetched with the App Store Connect API key), then `-exportArchive` with `destination=upload` to App Store Connect (TestFlight). `main` → the Dev app, tag → the Test build, manual `prod` → the App Store build behind the `prod` reviewer. Mails the result. `ios/TESTFLIGHT.md`. |
| `editor-test-build.yml` (Editor test build) | `vX.Y.Z` tags, manual runs (with a tag) | Sends a `repository_dispatch` (`celiador-release`, `{tag}`) to `Cliefden/celiador-editor`, whose *Release (macOS)* builds its `main` as the test channel and publishes it to test.celiador.ai. Needs the repository secret `EDITOR_DISPATCH_TOKEN` (fine-grained, `celiador-editor` only, *Contents: read and write*); without it, it warns and succeeds. |

Secrets stay on the box (`~/envs/<env>/daemon/.env`, written by
`daemon/deploy/provision-env.sh`); the workflow never writes them. This differs from
Celindor, which renders its secrets file from GitHub on every deploy — here the
JWT secret, the database password and the anon key are generated on the box.

## One-time setup

1. **GitHub Environments** `dev`, `test`, `prod` on `Cliefden/celiador` (done
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
   `VPS_SSH_KEY` in every Environment, swap the line in
   `authorized_keys`.

3. **Mail.** Repository secrets `SMTP_USER` (`stefan@celiador.ai`) and
   `SMTP_PASS` (its Migadu password); optional repository variables
   `NOTIFY_TO` (default `stefan@celiador.ai`) and `NOTIFY_SUCCESS=false` once
   only failures should mail. Without the secrets, results only show in GitHub
   (and GitHub mails the actor on failed runs anyway).

4. **Prod.** After the cutover to `celiador-daemon@prod` **and**
   `celiador-web@prod` (`ENVIRONMENTS.md` § Prod cutover):
   `gh variable set PROD_ENABLED --body true -R Cliefden/celiador`. The one
   variable unlocks prod for both deploy workflows.

5. **iOS signing.** `ios/scripts/ci-signing-setup.sh` once: it issues a CI-only
   Apple Distribution certificate and writes the five repository secrets the
   Build iOS workflow reads (`ios/TESTFLIGHT.md` § One-time setup).

`main` is not protected: `scripts/release.sh` commits to it directly, and a
push to it deploys dev, as on Celindor. Feature work goes through pull
requests (the issue → run → PR loop), releases through the script.
