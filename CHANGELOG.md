# Changelog

User-visible changes to Celiador — the daemon, the iPhone app and the site share
one release train (`RELEASING.md`). Record changes under **Unreleased** as they
merge; `scripts/release.sh` rolls the section into a version on release.

## [Unreleased]

## [0.2.5] - 2026-10-30

- iPhone app: the test channel is its own app, **Celiador Test**
  (`ai.celiador.companion.test`, URL scheme `celiador-test`), beside Celiador
  Dev and the App Store app. Until v0.2.4 a Test build was the prod bundle id
  and replaced the App Store install on the phone, hiding prod's data. The test
  daemon's push topic follows (`APNS_TOPIC`), as does the GoTrue allowlist;
  `ios/CHANNELS.md`.

## [0.2.4] - 2026-10-30

- No changes; released with the train.

## [0.2.3] - 2026-10-30

- iPhone app: a **Settings** tab. It opens with a "This build" card — app,
  version (build), channel, commit and the daemon it talks to, with "Copy build
  info" for issue reports — and on a dev or test build the tab carries a
  `DEV`/`TEST` badge so the install is identifiable from every screen (a Test
  build is the App Store app pointed at test.celiador.ai). Account (profile,
  usage, pull requests, deletion) is a screen under it; sign-out, notifications,
  usage-data sharing, Report an issue and the legal links sit on the Settings
  root. The Build iOS workflow now stamps the short commit into the app
  (`CELIADOR_COMMIT`); `ios/CHANNELS.md` § Telling the builds apart.
- iPhone app builds moved from Xcode Cloud to GitHub Actions
  (`.github/workflows/ios.yml`, "Build iOS"): push to `main` → the Dev app on
  TestFlight, a `vX.Y.Z` tag → the Test build, manual `prod` → the App Store
  build, all on the same triggers as the daemon and the site. Automatic
  signing through the App Store Connect API key with a CI-only distribution
  certificate (`ios/scripts/ci-signing-setup.sh`); the Xcode Cloud hook
  `ios/ci_scripts/` is gone. `ios/TESTFLIGHT.md` describes the pipeline.

## [0.2.2] - 2026-10-29

- One repository: `Cliefden/daemon` is now `Cliefden/celiador` and holds the
  daemon (`daemon/`), the iPhone app (`ios/`, formerly `celiador-ios`) and the
  site (`web/`, formerly `celiador-web`) with their full history. One
  `vX.Y.Z` tag releases all three; the iOS version now equals the daemon's.
- Sign-in: `GET /api/config` reports which sign-in methods are on
  (`signIn {password, magicLink, github}`, read from GoTrue and
  `CELIADOR_MAGIC_LINK`); the iPhone app hides the magic-link and GitHub
  buttons when they are off. Agent refusals (sign in, plan, quota, overloaded)
  answer with Anthropic's error envelope so clients show the reason (#54).
- Site: the Sign in docs and `/start` describe the editor's real first run
  (walkthrough, Account view, import step); the iPhone download row says
  "By invite" until the public TestFlight link is set; `ios/TESTFLIGHT.md`
  documents the public group as prod builds only (#55).
- iPhone app: report an issue from the Account screen in TestFlight and
  development builds, with version, channel, device and recent log attached
  (PortfolioFeedback).
- iPhone app: telemetry v2 — pairing funnel, steering, re-engagement surfaces
  and relay errors (#49); analytics declared in the privacy manifest, Watch
  build fixed (#53).

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
