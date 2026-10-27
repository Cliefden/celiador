# Celiador iOS

Celiador for iPhone is the review surface of the Celiador loop. Label a GitHub
issue `celiador` and an agent runs it in its own git worktree on your Mac (in the
Celiador editor, or in VS Code and Cursor with Celiador Remote); this app shows
the queue: what needs you, what is running, and the pull requests ready for
review. Read the agent's account of the change and the diff, send a follow-up,
allow or deny a risky command, answer its questions, and approve and merge, with
push and a Live Activity when a run needs you.

- **Backend:** the slim daemon (`Cliefden/daemon`) at `celiador.ai`. Auth is a
  Supabase session sent as `Authorization: Bearer`; the app never holds an LLM key.
- **Contract:** `/api/sessions/*` (watcher: list/get/create, live `events` SSE,
  `message`/`approvals`/`answers`/`cancel`) + `/api/push/*` for APNs.
- **History:** forked out of the retired `daemon-old/apps/apple` (the old
  app-builder companion) on 2026-09-24; the macOS target was dropped (the macOS
  product is the editor fork).

## Build

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodegen generate
# then build the Celiador scheme, or:
xcodebuild -project Celiador.xcodeproj -scheme Celiador -destination 'generic/platform=iOS Simulator' build
```

Targets: **Celiador** (the app) and **CeliadorWidgets** (Home Screen widget +
Live Activity). `Shared/` holds the dependency-free model, API, SSE, and theme.

Build channels (dev / staging / prod): `CHANNELS.md`. Xcode Cloud + TestFlight:
`TESTFLIGHT.md`.
