# Xcode Cloud + TestFlight

How a push to `main` becomes a Dev build on a phone, a `vX.Y.Z` tag a Test
build, and a button press an App Store build. Follows the portfolio standard
(`_standard/PORTFOLIO_STANDARD.md`: automatic signing, XcodeGen hook) and the
shared tooling in `Apps-AppStore/xcode-cloud-setup/`, extended with Celindor's
two-app channel model (`CHANNELS.md`): this repo has two Xcode Cloud products
and four workflows, not the standard two.

## The channels

| Xcode Cloud product (app) | Workflow | Starts on | Archives scheme | Goes to | Icon |
|---|---|---|---|---|---|
| **Celiador Dev** (`6828169951`) | **Dev** | push to `main` | `Celiador Dev` (Dev config → `dev.celiador.ai`) | TestFlight, internal | red, commit |
| **Celiador** (`6819707590`) | **Test** | tag `v*` | `Celiador Test` (Test config → `test.celiador.ai`) | TestFlight | green, tag |
| **Celiador** | **Archive - App Store** | manual | `Celiador` (Release config → `celiador.ai`) | TestFlight + App Store | plain |
| **Celiador** | *Default* (Xcode's build-on-main) | push to `main` | `Celiador`, build only | nothing | — |

Tags are per repo: the daemon's release train tags the daemon, and
`scripts/release.sh` tags this app (its versions move on their own). The
*Default* workflow is left as a compile check of the prod scheme; disable it in
App Store Connect if the Dev workflow is enough.

## What is already in the repo

- `ci_scripts/ci_post_clone.sh` — Xcode Cloud runs it after cloning: installs
  XcodeGen, generates `Celiador.xcodeproj` (gitignored) from `project.yml`,
  seeds the pinned `Package.resolved` (TelemetryDeck) into the generated
  workspace, and stamps the icon banner by channel (`CI_TAG` → green with the
  tag; otherwise red with the commit; a workflow whose name contains
  "App Store" keeps the plain icon).
- `project.yml` — three schemes, one per channel (`schemes:`): **Celiador**
  archives Release (`ai.celiador.companion`, `https://celiador.ai`,
  `Celiador/Celiador.production.entitlements`, `aps-environment: production`,
  the shared App Group), **Celiador Test** archives Test (same app, test
  daemon), **Celiador Dev** archives Dev (`ai.celiador.companion.dev`, dev
  daemon, development push). Xcode Cloud archives with the scheme's archive
  configuration, which is why each channel is a scheme and not a `-configuration`.
- `scripts/release.sh` — bumps `MARKETING_VERSION`, commits `Release vX.Y.Z`
  and tags; never pushes (see *Cutting builds*).
- **Automatic signing in every config.** Xcode Cloud requires it ("Allow Xcode to
  manage signing for you", Apple's *Setting up your project to use Xcode Cloud*);
  it signs with cloud-managed distribution certificates. The App Store profiles
  under `signing/` (`7453QR5RN8` app, `LF9K4K32P2` widgets) are no longer referenced
  by the project; they remain usable for a manual `asc xcode` archive with an
  explicit export-options plist.
- **TestFlight groups** `Internal`, one per app, each with access to all builds,
  so every processed build is immediately installable by its members:
  `5fd35a26-4b72-4f61-80c5-8531fb364bf8` on Celiador,
  `f8297a47-e0f3-49bc-abcd-7ae1eb8fb15f` on Celiador Dev.

## One-time onboarding (Stefan)

Xcode Cloud "products" and the GitHub connection cannot be created through the
App Store Connect API; this is the only manual part. The **Celiador** product
exists (onboarded 2026-10-18) with *Default*, *Archive - App Store* and *Test*.
The **Celiador Dev** product is the one still to create:

1. **Repo access** is already granted (github.com → Settings → Applications →
   *Xcode Cloud* → Repository access → `Cliefden/celiador-ios`).
2. **Create the Dev product in Xcode.**
   ```sh
   cd celiador-ios && DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodegen generate
   open Celiador.xcodeproj
   ```
   Select the **Celiador Dev** scheme, then Product ▸ Xcode Cloud ▸ Create
   Workflow… → app **Celiador dev** (`ai.celiador.companion.dev`), team
   `XPNFDWPFAV` → accept the default workflow → grant source control access if
   asked. This creates the `Celiador Dev` ciProduct.
3. **Add the channel workflows** (API, from any session, idempotent):
   ```sh
   python3 ../../xcode-cloud-setup/create_workflows.py celiador       # adds "Test" (tag v* → TestFlight) — done
   python3 ../../xcode-cloud-setup/create_workflows.py celiador-dev   # adds "Dev" (main → TestFlight), disables Xcode's "Default"
   ```
   Each prints the product, repository and workflow names. The Dev product's
   automatic signing adds push + App Group to the `.dev` App IDs on the first run.

## Cutting builds

- **Dev:** merge to `main`. The Dev app updates on the phone through TestFlight
  (internal group, no beta review).
- **Test:** on a clean `main` equal to `origin/main`:
  ```sh
  scripts/release.sh patch            # or minor / major / X.Y.Z — commit + tag, not pushed
  git push origin main
  git push origin vX.Y.Z              # the Test workflow archives the tag → TestFlight
  ```
  The build appears in App Store Connect as `X.Y.Z (<Xcode Cloud build number>)`
  with the green tag banner on its icon. A tester who installs it has the real
  app pointed at test: a session kept from prod gets a 401 and the app asks to
  sign in again (against test's own GoTrue). To go back to prod, install the
  latest *Archive - App Store* build from TestFlight's previous builds, or the
  App Store version.
- **App Store:**
  ```sh
  python3 ../../xcode-cloud-setup/start_archive.py celiador     # starts "Archive - App Store" on main
  python3 ../../xcode-cloud-setup/poll_runs.py <runId>          # waits for the run
  ```
  or App Store Connect → Xcode Cloud → *Archive - App Store* → Start Build. The
  archive uploads to App Store Connect; once processed, the `Internal` group can
  install it from the TestFlight app (sign in with the same Apple ID as the team).

Then attach **What to Test** notes (template: `testflight/WHAT_TO_TEST.md`):

```sh
asc builds list --app 6819707590 --limit 1 --output table          # newest build id
asc builds test-notes create --build-id <BUILD_ID> --locale en-US --whats-new @file:testflight/WHAT_TO_TEST.md
```

## Verifying the first build (ios#2 checklist)

- Install from TestFlight on the iPhone (the Dev app stays side by side:
  different bundle id).
- Sign in against prod; the phone must appear in the editor's presence picker and
  receive a push when a run needs you (production APNs now, so the daemon's
  `APNS_ENV` must be `production` for this bundle id).
- Run through daemon#9's phone legs on this build.

## Versioning

`MARKETING_VERSION` lives in `project.yml` (app, widgets and watch must match;
`scripts/release.sh` keeps them in step). Xcode Cloud numbers the builds itself
(every upload so far: `0.2.0 (10…22)`), so `CURRENT_PROJECT_VERSION` in
`project.yml` is only the local default.
