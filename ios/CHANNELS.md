# iOS build channels — dev / staging / prod

Three Xcode build configurations point the companion at the matching daemon
environment (see `daemon/ENVIRONMENTS.md`). Defined in `project.yml` (`configs` +
`configFiles`) and `Config/*.xcconfig`.

| Config | Daemon (`CELIADOR_DAEMON_URL`) | Bundle ID | Display name | URL scheme |
|---|---|---|---|---|
| **Dev** (debug) | `http://localhost:4661` | `ai.celiador.companion.dev` | Celiador Dev | `celiador-dev` |
| **Staging** (release) | `https://staging.celiador.ai` | `ai.celiador.companion.staging` | Celiador Staging | `celiador-staging` |
| **Release** (release) | `https://celiador.ai` | `ai.celiador.companion` | Celiador | `celiador` |

The app reads the daemon URL as: `CELIADOR_URL` env var (scheme override in the
simulator) → `CELIADOR_DAEMON_URL` from `Info.plist` (the build channel) →
`https://celiador.ai` (`Shared/Api.swift`). The suffix flows to the app, widgets,
and watch bundle IDs (and the watch's `WKCompanionAppBundleIdentifier`) so all
three channels install side-by-side.

Build staging/dev by selecting the configuration:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
  xcodebuild -scheme Celiador -configuration Staging \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Regenerate the project after editing `project.yml`/xcconfigs: `xcodegen generate`.

## Notes / follow-ups for device + TestFlight

- **App Group stays shared** (`group.ai.celiador.companion`) across channels —
  it's hardcoded in `Shared/WidgetShared.swift`, and the auth/isolation boundary
  is the daemon's per-env JWT secret, not widget storage. Leave as-is unless we
  want per-channel widget data.
- **Signing:** automatic in every config (Xcode Cloud requires it — see
  `TESTFLIGHT.md`); the per-channel bundle IDs need matching App IDs and an APNs
  key authorized for each (push topic = the bundle ID). Simulator builds
  (`CODE_SIGNING_ALLOWED=NO`) don't need them.
- **Auth deep link:** each channel's GoTrue redirect allowlist must include its
  scheme (`celiador-staging://…`, `celiador-dev://…`).
