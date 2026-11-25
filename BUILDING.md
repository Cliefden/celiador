# Local cheat sheet

The everyday local commands, run from the repository root (or from a worktree's
root: every command builds the checkout it runs in, uncommitted changes
included). The editor builds in its own repository,
[`Cliefden/celiador-editor`](https://github.com/Cliefden/celiador-editor).

| I want to… | Run |
| --- | --- |
| Run the daemon on this Mac (:4661) | `npm --prefix daemon run dev` |
| Check the daemon like CI does | `npm --prefix daemon run typecheck && npm --prefix daemon run smoke` |
| Run the site (:3000) | `npm --prefix web run dev` |
| Build the iPhone app | `cd ios && xcodegen generate`, then Xcode or `xcodebuild` (below) |
| Regenerate the client types after an API change | `npm --prefix packages/client run generate` |
| Create an issue in the Backlog | `wb issue` |
| Take a task from the board and get a worktree for it | `wb start` |
| Run daemon + site from this checkout | `wb dev` |
| Open the PR for this worktree | `wb pr` (a draft; `gh pr ready` once it's done) |
| Merge the ready PRs | `wb train build`, then `wb train land <train PR#>` |
| Cut a release | `scripts/release.sh patch` ([RELEASING.md](RELEASING.md)) |

`wb` is [Cliefden/workbench](https://github.com/Cliefden/workbench); its
[`WORKTREES.md`](https://github.com/Cliefden/workbench/blob/main/WORKTREES.md) is
the manual for working this way. This repo's settings for it are in
[`.workbench`](.workbench).

---

## The daemon

```bash
cd daemon
npm install
cp .env.example .env     # ANTHROPIC_API_KEY, plus SUPABASE_JWT_SECRET for real sign-in,
                         # or CELIADOR_ALLOW_NO_AUTH=1 for loopback no-auth dev
npm run dev              # tsx watch → http://127.0.0.1:4661
npm run typecheck
npm run smoke            # the offline smoke test CI runs: no network, no real key
npm run migrate          # db/migrations, forward only (needs DATABASE_URL)
```

- **No build step:** `tsx` runs the TypeScript directly, in dev and on the box.
- **State lives under `daemon/data/`** of the checkout it runs from (gitignored;
  `CELIADOR_HOME` moves it). Durable profiles and chats go to Postgres only when
  `DATABASE_URL` is set; unset, that persistence is a no-op.
- What every endpoint does: [`daemon/README.md`](daemon/README.md); the client
  contract: [`daemon/docs/CLIENT_INTEGRATION.md`](daemon/docs/CLIENT_INTEGRATION.md).

## The API types

`packages/client/openapi.yaml` is the daemon's client contract;
`packages/client/src/schema.ts` is generated from it and committed. Change the
YAML, then:

```bash
npm --prefix packages/client ci
npm --prefix packages/client run generate   # writes src/schema.ts
npm --prefix packages/client run check      # what CI checks: generated file up to date + tsc
```

Never resolve a conflict in `schema.ts` by hand: take either side, then
regenerate. `wb train build` does that itself (`wb_regen` in `.workbench`).

## The iPhone app

```bash
cd ios
xcodegen generate              # the .xcodeproj is generated and gitignored
open Celiador.xcodeproj
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
  xcodebuild -scheme Celiador -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

- **Three schemes, three apps:** `Celiador` (prod), `Celiador Test`,
  `Celiador Dev` ([`ios/CHANNELS.md`](ios/CHANNELS.md)).
- **Against your local daemon:** run the `Celiador Dev` scheme in the
  simulator and enable its `CELIADOR_URL=http://localhost:4661` environment
  variable (Edit Scheme → Run → Arguments). Scheme variables only apply when
  Xcode launches the app.
- Builds for TestFlight are made by GitHub Actions, not locally
  ([`ios/TESTFLIGHT.md`](ios/TESTFLIGHT.md)).

## The site

```bash
cd web
npm install
npm run dev          # http://localhost:3000
npm run lint && npm run typecheck && npm run build   # what CI runs
```

---

## Creating an issue

```bash
wb issue                              # asks for the title too
wb issue Phone shows the wrong branch # the words become the title
wb issue --dry-run …                  # shows the result, creates nothing
```

It asks for a description, the type, Priority, Size and the area (`daemon`,
`ios` or `web`), guessing type and area from the words, and files the issue in
**Backlog** on the **Celiador** board.

- **The repo is public.** An exploitable security problem goes into a private
  security advisory, never an issue.
- **Never put the `celiador` label on an issue** by hand: it starts an agent
  run.

## Worktrees

Each issue gets its own checkout under `.claude/worktrees/` (gitignored), so
one can sit half-done while you review another and Claude works on a third.
The main checkout stays on `main`.

```bash
wb start                 # pick from Ready: yours or nobody's, best first
wb start 42              # take #42: assign you, In progress, branch + worktree, setup
cd "$(wb path 42)"
wb status                # every worktree: issue, column, changes, PR, what can go
wb pr --dry-run          # the PR it would open
wb pr                    # push, open it as a draft (no CI), In review
gh pr ready              # once done: CI runs
gh pr edit --add-label merge-train
wb train build           # the labelled, green PRs onto one train/<stamp> PR
wb train land <train#>   # its CI green: fast-forward main (deploys dev)
wb rm 42                 # after the merge; moves the card to Done
```

- **Setup:** a new worktree gets the gitignored files in
  [`.worktreeinclude`](.worktreeinclude) (`daemon/.env`, Claude's local
  settings) copied from the main checkout, then `npm install` in `daemon/` and
  `web/`, and `xcodegen generate` in `ios/`. `wb setup` repeats it;
  `--no-install` skips it for doc-only work.
- **Drafts run no CI**, and PRs reach `main` in merge trains, so CI and deploys
  run once per train. Test locally before `gh pr ready`.
- **Changelog:** a user-visible change adds its own fragment file instead of
  editing `CHANGELOG.md` ([RELEASING.md](RELEASING.md)).
- **In Claude Code:** `/start-issue [<issue#>]` does `wb start`, then reads the
  issue and plans from it.

### Switching the running stack

```bash
wb dev            # daemon (:4661) + site (:3000) from this checkout
wb dev status     # which checkout each one runs from
wb dev stop
```

It stops them wherever else they run (the main checkout or another worktree)
and starts them here.

### What the worktrees share

Only the files in the repository are separate. Shared by all of them:

- **Ports 4661 and 3000.** One daemon and one site at a time; `wb dev` moves
  them.
- **The database, if `daemon/.env` sets `DATABASE_URL`.** A migration run from
  a branch lands in that one database, which every other checkout then sees.
  `wb status` warns when two branches take the same migration number.
- **Supabase (sign-in) and everything on the box.** A local daemon with the
  real `SUPABASE_*` settings uses real accounts.
- **The iOS simulator and its installed apps**, Xcode's DerivedData, and the
  signed-in `gh`.
- **The git stash.** Set work aside with a WIP commit, never `git stash`.

Not shared: `daemon/.env` is copied, not linked (an edit in one worktree stays
there), and each daemon keeps its own `daemon/data/`.
