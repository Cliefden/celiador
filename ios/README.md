# Celiador iOS

The iPhone **companion** for the Celiador editor. It attaches to the daemon's
agent-session relay so you can watch an agent run happening in your desktop editor
live, and steer it from your phone — send a follow-up prompt, approve or reject a
file write, or cancel — with push + Live Activity when it needs you.

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
