# iOS build channels — dev / test / prod

Two App Store Connect apps, the way Celindor does it (`Celindor/celindor/RELEASING.md`
§ App Store), pointed at the daemon environments in `daemon/ENVIRONMENTS.md`.
Three Xcode build configurations, defined in `project.yml` (`configs` +
`configFiles`) and `Config/*.xcconfig`, each archived by its own scheme —
Xcode Cloud archives with the scheme's archive configuration, so the scheme is
how a workflow picks a channel:

| Config | Scheme | App | Bundle ID | Daemon (`CELIADOR_DAEMON_URL`) | URL scheme | Xcode Cloud workflow |
|---|---|---|---|---|---|---|
| **Dev** (debug) | `Celiador Dev` | Celiador Dev | `ai.celiador.companion.dev` | `https://dev.celiador.ai` | `celiador-dev` | **Dev**: push to `main` → TestFlight (Dev app) |
| **Test** (release) | `Celiador Test` | Celiador | `ai.celiador.companion` | `https://test.celiador.ai` | `celiador` | **Test**: tag `vX.Y.Z` → TestFlight |
| **Release** (release) | `Celiador` | Celiador | `ai.celiador.companion` | `https://celiador.ai` | `celiador` | **Archive - App Store**: manual |

The Dev app installs beside the real one (own bundle id, own name, own URL
scheme). The Test config is the real app pointed at the test environment: a
TestFlight build of it replaces the App Store build on a tester's phone, and
a token it kept from test is refused by prod (401) — the app then asks to sign
in again. There is no `.test` bundle id.

The app reads the daemon URL as: `CELIADOR_URL` env var (scheme override) →
`CELIADOR_DAEMON_URL` from `Info.plist` (the build channel) →
`https://celiador.ai` (`Shared/Api.swift`). The Dev suffix flows to the app,
widgets and watch bundle IDs (and the watch's `WKCompanionAppBundleIdentifier`).

Running from Xcode: the `Celiador` scheme runs the Dev config (debug build of
the Dev app) with `CELIADOR_URL=https://celiador.ai` enabled, i.e. against
prod — the long-standing dogfooding setup. The `Celiador Dev` scheme runs the
same build against `dev.celiador.ai`, with a disabled
`CELIADOR_URL=http://localhost:4661` to flip on for a daemon on this Mac
(simulator only). Scheme env vars apply only when launched from Xcode; a
standalone relaunch falls back to the xcconfig.

Build a channel by selecting its scheme:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
  xcodebuild -scheme "Celiador Test" \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Regenerate the project after editing `project.yml`/xcconfigs: `xcodegen generate`.
The workflows themselves are described in `TESTFLIGHT.md`.

## Icon banner

As on Celindor, Xcode Cloud builds carry a banner across the app icon so they
are told apart on the home screen: `ci_scripts/ci_post_clone.sh` stamps
`AppIcon.appiconset` with `scripts/icon-banner.swift` (Swift only, no
ImageMagick) — **green with the tag** for a tag-started build (the Test
workflow), **red with the short commit** for everything else (the Dev
workflow). A workflow whose name contains "App Store" keeps the plain icon.
Only the Xcode Cloud checkout is stamped; the committed icons never change.
Locally: `swift scripts/icon-banner.swift "#c62828" 1a2b3c4 Celiador/Assets.xcassets/AppIcon.appiconset/*.png`,
undo with `git checkout Celiador/Assets.xcassets`.

## Telemetry

`Celiador/Telemetry.swift` sends in TelemetryDeck test mode from the Dev app
and from any build whose daemon is not `celiador.ai` (so a Test build on
TestFlight stays out of the production dashboard).

## Notes / follow-ups for device + TestFlight

- **App Store Connect:** two app records — **Celiador** (`6819707590`,
  `ai.celiador.companion`) and **Celiador dev** (`6828169951`,
  `ai.celiador.companion.dev`); both bundle ids and their `.widgets` App IDs are
  registered, and each app has an `Internal` TestFlight group with access to
  all builds. Push and App Group capabilities on the dev App IDs are added by
  automatic signing on the first Xcode Cloud build. Workflows: `TESTFLIGHT.md`.
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
