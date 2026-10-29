# Changelog

User-visible changes to Celiador — the daemon, the iPhone app and the site share
one release train (`RELEASING.md`). Record changes under **Unreleased** as they
merge; `scripts/release.sh` rolls the section into a version on release.

## [Unreleased]

- One repository: `Cliefden/daemon` is now `Cliefden/celiador` and holds the
  daemon (`daemon/`), the iPhone app (`ios/`, formerly `celiador-ios`) and the
  site (`web/`, formerly `celiador-web`) with their full history. One
  `vX.Y.Z` tag releases all three; the iOS version now equals the daemon's.

## [0.2.0] - 2026-10-28

- Environments: dev (`dev.celiador.ai`) and test (`test.celiador.ai`) beside
  prod, each with its own daemon, Postgres and GoTrue; `/api/health` reports
  `env` and `commit` (#41).
- Deploy pipeline: push to `main` deploys dev, a `vX.Y.Z` tag deploys test,
  prod by manual dispatch behind a required reviewer; forward-only
  migrations (`npm run migrate`); results mailed (#42).
- Sessions: a task is linked to its mirror even when another window won the
  claim; PR body run-in headings (#40).
- Tasks: a dispatch the Mac never started is reclaimed (#39); a stale error is
  cleared by the next good status report (#36).
- Cost: prompt-cache reads and writes priced at their own rates (#38); per-run
  cost, cloud fallback and GitHub as the product surface (#37).
- Agents UI data: task timeline, live state, PR refresh, merge + follow-up,
  deep links (#35).
- Admin: global daily agent cap, 90-day usage history, `GET /api/admin/usage`
  (#32), admins by email (#33), `scripts/admin-usage.py` (#34).
- Relay: one mirror per runner-side session (#31); chat-history and push
  failures counted on `/api/health` (#30); message `seq` returned as a number
  (#29); streamed assistant replies saved, chats upsert type clash fixed (#28).
- Gateway: per-turn effort dropped when the model is overridden (#27).
