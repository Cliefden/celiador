# Xcode Cloud + TestFlight

How a push to `main` becomes a build, and a button press becomes a TestFlight
build on a phone. Follows the portfolio standard (`_standard/PORTFOLIO_STANDARD.md`:
exactly two workflows, automatic signing, XcodeGen hook) and the shared tooling in
`Apps-AppStore/xcode-cloud-setup/`.

## What is already in the repo

- `ci_scripts/ci_post_clone.sh` — Xcode Cloud runs it after cloning: installs
  XcodeGen and generates `Celiador.xcodeproj` (gitignored) from `project.yml`.
  No Swift packages, so no `Package.resolved` seeding is needed yet; if a package
  is ever added, follow the gotcha in `xcode-cloud-setup/README.md`.
- `project.yml` — the **Celiador** scheme archives with the `Release` config:
  `ai.celiador.companion`, `https://celiador.ai`, `Celiador/Celiador.production.entitlements`
  (`aps-environment: production`, the shared App Group). Dev keeps development push.
- **Automatic signing in every config.** Xcode Cloud requires it ("Allow Xcode to
  manage signing for you", Apple's *Setting up your project to use Xcode Cloud*);
  it signs with cloud-managed distribution certificates. The App Store profiles
  under `signing/` (`7453QR5RN8` app, `LF9K4K32P2` widgets) are no longer referenced
  by the project; they remain usable for a manual `asc xcode` archive with an
  explicit export-options plist.
- **TestFlight group** `Internal` (`5fd35a26-4b72-4f61-80c5-8531fb364bf8`) exists on
  app `6819707590` with access to all builds, so every processed build is
  immediately installable by its members.

## One-time onboarding (Stefan)

Xcode Cloud "products" and the GitHub connection cannot be created through the
App Store Connect API; this is the only manual part.

1. **Let Xcode Cloud see the repo.** github.com → Settings → Applications →
   *Xcode Cloud* → Repository access → add `Cliefden/celiador-ios` (it is private;
   the other apps' repos are already granted).
2. **Create the product in Xcode.**
   ```sh
   cd celiador-ios && DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodegen generate
   open Celiador.xcodeproj
   ```
   Product ▸ Xcode Cloud ▸ Create Workflow… → app **Celiador**, team
   `XPNFDWPFAV` → accept the default build-on-`main` workflow → grant source
   control access when asked. This creates the `Celiador` ciProduct.
3. **Add the manual archive workflow** (API, from any session):
   ```sh
   python3 ../../xcode-cloud-setup/create_workflows.py celiador
   ```
   Idempotent; prints the product, repository and workflow names. If Xcode's
   default build workflow is missing, add `--force-build`.

## Cutting a TestFlight build

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

- Install from TestFlight on the iPhone (the Dev build installed via Xcode stays
  side by side: different bundle id).
- Sign in against prod; the phone must appear in the editor's presence picker and
  receive a push when a run needs you (production APNs now, so the daemon's
  `APNS_ENV` must be `production` for this bundle id).
- Run through daemon#9's phone legs on this build.

## Versioning

`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` live in `project.yml` (app and
widgets must match). Xcode Cloud can manage the build number itself (App Store
Connect → Xcode Cloud → workflow → *Next build number*); bump `MARKETING_VERSION`
in `project.yml` for a new version.
