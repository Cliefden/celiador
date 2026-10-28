# iOS build channels — dev / test / prod

Two App Store Connect apps, the way Celindor does it (`Celindor/celindor/RELEASING.md`
§ App Store), pointed at the daemon environments in `daemon/ENVIRONMENTS.md`.
Three Xcode build configurations, defined in `project.yml` (`configs` +
`configFiles`) and `Config/*.xcconfig`:

| Config | App | Bundle ID | Daemon (`CELIADOR_DAEMON_URL`) | URL scheme | Built when |
|---|---|---|---|---|---|
| **Dev** (debug) | Celiador Dev | `ai.celiador.companion.dev` | `http://localhost:4661` (Xcode) / `https://dev.celiador.ai` (TestFlight) | `celiador-dev` | push to `main` → TestFlight |
| **Test** (release) | Celiador | `ai.celiador.companion` | `https://test.celiador.ai` | `celiador` | tag `vX.Y.Z` → TestFlight |
| **Release** (release) | Celiador | `ai.celiador.companion` | `https://celiador.ai` | `celiador` | manual → App Store |

The Dev app installs beside the real one (own bundle id, own name, own URL
scheme). The Test config is the real app pointed at the test environment: a
TestFlight build of it replaces the App Store build on a tester's phone, and
a token it kept from test is refused by prod (401) — the app then asks to sign
in again. There is no `.test` bundle id.

The app reads the daemon URL as: `CELIADOR_URL` env var (scheme override in the
simulator) → `CELIADOR_DAEMON_URL` from `Info.plist` (the build channel) →
`https://celiador.ai` (`Shared/Api.swift`). The Dev suffix flows to the app,
widgets and watch bundle IDs (and the watch's `WKCompanionAppBundleIdentifier`).

Build a channel by selecting the configuration:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
  xcodebuild -scheme Celiador -configuration Test \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Regenerate the project after editing `project.yml`/xcconfigs: `xcodegen generate`.

## Telemetry

`Celiador/Telemetry.swift` sends in TelemetryDeck test mode from the Dev app
and from any build whose daemon is not `celiador.ai` (so a Test build on
TestFlight stays out of the production dashboard).

## Notes / follow-ups for device + TestFlight

- **App Store Connect:** the `ai.celiador.companion.dev` bundle id exists; the
  **Celiador Dev** app record, its widgets App ID
  (`ai.celiador.companion.dev.widgets`, push + App Group) and a TestFlight
  group on it are created in Phase 3 of the environments plan, with the Xcode
  Cloud workflows (Dev on `main`, Test on tags, Archive - App Store manual).
- **App Group stays shared** (`group.ai.celiador.companion`) across channels —
  it's hardcoded in `Shared/WidgetShared.swift`, and the auth/isolation boundary
  is the daemon's per-env JWT secret, not widget storage.
- **Signing:** automatic in every config (Xcode Cloud requires it — see
  `TESTFLIGHT.md`). The APNs team key serves both apps; the push topic is the
  bundle id, so the dev daemon sends to `ai.celiador.companion.dev` and the test
  and prod daemons to `ai.celiador.companion`.
- **Auth deep links:** each environment's GoTrue allowlist holds its clients'
  schemes — dev: `celiador-dev://*`; test: `celiador://*` (+ the test editor's
  `celiador-test://*`); prod: `celiador://*`.
