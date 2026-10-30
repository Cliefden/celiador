# iOS build channels — dev / test / prod

Two App Store Connect apps, the way Celindor does it (`Celindor/celindor/RELEASING.md`
§ App Store), pointed at the daemon environments in `../ENVIRONMENTS.md`.
Three Xcode build configurations, defined in `project.yml` (`configs` +
`configFiles`) and `Config/*.xcconfig`, each archived by its own scheme —
`xcodebuild archive` uses the scheme's archive configuration, so the scheme is
how the build workflow (`.github/workflows/ios.yml`) picks a channel:

| Config | Scheme | App | Bundle ID | Daemon (`CELIADOR_DAEMON_URL`) | URL scheme | Build iOS channel |
|---|---|---|---|---|---|---|
| **Dev** (debug) | `Celiador Dev` | Celiador Dev | `ai.celiador.companion.dev` | `https://dev.celiador.ai` | `celiador-dev` | **dev**: push to `main` → TestFlight (Dev app) |
| **Test** (release) | `Celiador Test` | Celiador Test | `ai.celiador.companion` | `https://test.celiador.ai` | `celiador` | **test**: tag `vX.Y.Z` → TestFlight |
| **Release** (release) | `Celiador` | Celiador | `ai.celiador.companion` | `https://celiador.ai` | `celiador` | **prod**: manual dispatch → App Store Connect |

The Dev app installs beside the real one (own bundle id, own name, own URL
scheme). The Test config is the real app pointed at the test environment: a
TestFlight build of it replaces the App Store build on a tester's phone, and
a token it kept from test is refused by prod (401) — the app then asks to sign
in again. There is no `.test` bundle id, so the Test build is named
**"Celiador Test"** on the home screen (`APP_NAME` in `Config/Test.xcconfig`)
to say where it points; App Store Connect and the TestFlight app still list it
under the shared record "Celiador". Each environment has its own database, so
a Test or Dev install never shows prod's tasks, runs or history
(`../ENVIRONMENTS.md`).

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

As on Celindor, CI builds carry a banner across the app icon so they are told
apart on the home screen: the Build iOS workflow stamps `AppIcon.appiconset`
with `scripts/icon-banner.swift` (Swift only, no ImageMagick) — **green with
the tag** for the test channel, **red with the short commit** for dev. The prod
build keeps the plain icon. Only the runner's checkout is stamped; the
committed icons never change.
Locally: `swift scripts/icon-banner.swift "#c62828" 1a2b3c4 Celiador/Assets.xcassets/AppIcon.appiconset/*.png`,
undo with `git checkout Celiador/Assets.xcassets`.

## Telling the builds apart in the app

The **Settings** tab (`Celiador/SettingsView.swift`) opens with a "This build"
card: app name, `version (build)`, the channel as a loud pill, the commit and
the daemon host — and on a dev or test build the Settings tab itself carries
the channel (`DEV` / `TEST`) as its badge, so the install is identifiable from
every screen. This matters because a Test build *is* the prod app (same bundle
id, same icon). "Copy build info" puts the whole line on the pasteboard for
an issue. All of it comes from `Celiador/BuildInfo.swift`, which is also what
`Telemetry` (test mode) and `Feedback` (report context) use, so the three can't
disagree.

The card tints red for dev and green for test — the icon-banner colours below.
The commit arrives as `CELIADOR_COMMIT` in `Info.plist`: the Build iOS workflow
passes `CELIADOR_COMMIT=${GITHUB_SHA::7}` to `xcodebuild archive`; a build
from Xcode leaves it empty and the card says "local build". The daemon row
shows an `override` pill when `CELIADOR_URL` (a scheme env var) is in effect,
because then the channel follows the daemon, not the xcconfig.

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
  automatic signing on the first CI build. The workflow: `TESTFLIGHT.md`.
- **App Group stays shared** (`group.ai.celiador.companion`) across channels —
  it's hardcoded in `Shared/WidgetShared.swift`, and the auth/isolation boundary
  is the daemon's per-env JWT secret, not widget storage.
- **Signing:** automatic in every config, driven in CI by the App Store Connect
  API key and a CI-only distribution certificate (`TESTFLIGHT.md`). The APNs
  team key serves both apps; the push topic is the
  bundle id, so the dev daemon sends to `ai.celiador.companion.dev` and the test
  and prod daemons to `ai.celiador.companion`.
- **Auth deep links:** each environment's GoTrue allowlist holds its clients'
  schemes — dev: `celiador-dev://*`; test: `celiador://*` (+ the test editor's
  `celiador-test://*`); prod: `celiador://*`.
