# GitHub Actions + TestFlight

How a push to `main` becomes a Dev build on a phone, a `vX.Y.Z` tag a Test
build, and a button press an App Store build. The app is built by
`.github/workflows/ios.yml` ("Build iOS") on GitHub-hosted macOS runners — the
same triggers as the daemon's and the site's deploys (`../RELEASING.md`), so one
tag is one release of the whole product. Xcode Cloud is not used (it was, until
2026-10-30: its products are bound to one GitHub repository and could not be
re-created against this one after the move from `celiador-ios`).

## The channels

| Channel | Starts on | Archives scheme | App | Goes to | Icon |
|---|---|---|---|---|---|
| **dev** | push to `main` touching `ios/` | `Celiador Dev` (Dev config → `dev.celiador.ai`) | Celiador Dev (`6828169951`, `ai.celiador.companion.dev`) | TestFlight, `Internal` group | red, commit |
| **test** | tag `vX.Y.Z` | `Celiador Test` (Test config → `test.celiador.ai`) | Celiador Test (`6828976551`, `ai.celiador.companion.test`) | TestFlight, `Internal` group | green, tag |
| **prod** | Actions → Build iOS → Run workflow → `prod` (the `prod` Environment's reviewer approves) | `Celiador` (Release config → `celiador.ai`) | Celiador | App Store Connect: TestFlight + App Store review | plain |

`CHANNELS.md` explains the configs, schemes and xcconfigs behind this. The
version is `MARKETING_VERSION` in `project.yml` (kept equal to the daemon's by
`../scripts/release.sh`); the build number is `1000 + the workflow run number`,
so every upload is unique and increasing. A tag build checks that the tag equals
the version and sits on `main`.

## What the workflow does

1. `plan` (Linux): decides the channel, scheme, version and build number.
2. `build` (macOS 26 runner, Xcode 26.6 — `DEVELOPER_DIR` at the top of the
   workflow): `brew install xcodegen`, `xcodegen generate`, seeds the pinned
   `Package.resolved` into the generated workspace, stamps the icon banner
   (`scripts/icon-banner.swift`: red + short commit for dev, green + tag for
   test, nothing for prod), then:
   - creates a throwaway keychain with the **CI distribution certificate** and
     Apple's WWDR intermediate;
   - `xcodebuild archive -scheme <channel's scheme> -allowProvisioningUpdates
     -authenticationKey…` — the project's automatic signing, driven by the App
     Store Connect API key;
   - `xcodebuild -exportArchive` with `destination: upload` and **manual**
     signing: the channel's two App Store profiles ("Celiador [Dev] CI App
     Store" + "… Widgets CI App Store", bound to the CI certificate; fetched by
     name and installed with fastlane's `sigh --readonly` using the same API
     key, since xcodebuild only downloads profiles for automatic signing)
     re-sign the app for distribution and the build is uploaded straight to
     App Store Connect.
     Manual, because automatic export is Xcode "cloud signing", which an App
     Manager key is not allowed to do. The App Store profiles carry
     `aps-environment: production`, so the Dev app's TestFlight build receives
     production APNs: the dev daemon's `APNS_ENV` must be `production`.
   - keeps the export report as a run artifact for two weeks; deletes the
     keychain and the key.
3. `notify`: mails the result through the repository's `SMTP_USER` / `SMTP_PASS`
   like the other workflows.

The `Internal` TestFlight group of each app has access to all builds, so a
processed build is installable by its members with no further step: dev
`f8297a47-e0f3-49bc-abcd-7ae1eb8fb15f` (Celiador Dev), test
`6b1cbdb2-d702-4a13-ad52-adba03af2c01` (Celiador Test), prod
`5fd35a26-4b72-4f61-80c5-8531fb364bf8` (Celiador). Minutes are free: the
repository is public.

## One-time setup (Stefan)

The workflow needs five repository secrets, all written by one script:

```sh
ios/scripts/ci-signing-setup.sh        # from a Mac with asc (profile celiador) + gh
```

It generates a private key here, has App Store Connect issue an **Apple
Distribution certificate for it** (a CI-only certificate — revoking it never
touches the one in your login keychain; Apple allows three per team), packages
it as a `.p12`, (re)creates the six **App Store profiles** bound to it that
the export step names, and sets:

| Secret | What |
|---|---|
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` | the App Store Connect API key (`R73AU5822H`, "Fastlane", App Manager — the one `asc --profile celiador` and `fastlane/` use; the `.p8` from `~/.appstoreconnect/private_keys/`) |
| `IOS_DIST_P12_BASE64`, `IOS_DIST_P12_PASSWORD` | the CI certificate + key |
| `IOS_DEV_P12_BASE64` | the CI **Apple Development** certificate + the same private key, as a `.p12` (same password as the distribution one). The archive step signs with a development identity; without this, `-allowProvisioningUpdates` mints a new development certificate per run and the team hits Apple's certificate cap within a day. Optional until the setup script has been re-run; the workflow warns when it is missing. |

Re-running the script rotates everything (then revoke the previous CI
certificate: `asc --profile celiador certificates list`, `… revoke --id`).
Nothing else is manual: the GitHub Environments `dev`/`test`/`prod` already
exist for the daemon (`prod` has the required reviewer), and the App Store
profiles are created by the first build.

The first run on each channel is the test of the setup: `gh workflow run
ios.yml -R Cliefden/celiador -f channel=dev` (or push a change under `ios/`),
then `gh run watch`. The build shows up in App Store Connect → TestFlight a few
minutes after the upload.

## Cutting builds

- **Dev:** merge to `main`. The Dev app updates on the phone through TestFlight
  (internal group, no beta review).
- **Test:** on a clean `main` equal to `origin/main`:
  ```sh
  scripts/release.sh patch            # from the repo root: bumps daemon + app, commit + tag, not pushed
  git push origin main                # the Dev app builds; daemon/web → dev — wait for green
  git push origin vX.Y.Z              # the Test build → TestFlight (and the daemon/web test deploys)
  ```
  The build appears in App Store Connect as `X.Y.Z (1nnn)` with the green tag
  banner on its icon. A tester who installs it has the real app pointed at
  test: a session kept from prod gets a 401 and the app asks to sign in again
  (against test's own GoTrue). To go back to prod, install the latest prod
  build from TestFlight's previous builds, or the App Store version. Test
  builds stay with the `Internal` group and are never added to the `Public`
  group (see *External testers* below).
- **App Store:**
  ```sh
  gh workflow run ios.yml -R Cliefden/celiador --ref vX.Y.Z -f channel=prod   # the reviewer approves in GitHub
  gh run watch -R Cliefden/celiador
  ```
  or GitHub → Actions → Build iOS → Run workflow → `prod` from the tag. The
  upload lands in TestFlight (plain icon); submit it to App Store review from
  App Store Connect, or with `fastlane deliver` from `fastlane/`.

Then attach **What to Test** notes (template: `testflight/WHAT_TO_TEST.md`):

```sh
asc --profile celiador builds list --app 6828976551 --limit 1 --output table          # newest Test build id (6819707590 for a prod build)
asc --profile celiador builds test-notes create --build-id <BUILD_ID> --locale en-US --whats-new @file:testflight/WHAT_TO_TEST.md
```

## External testers (the public link)

The site's download page, `/start` and `/docs` offer the iPhone app "by invite
from the contact page" until `web/src/lib/site.ts` `testflightUrl` holds a
public TestFlight link. That link belongs to an **external** group on the
**Celiador** app (`6819707590`), and which builds it receives is the whole
point of this section:

- The **test** channel (tag `v*`) ships the real app pointed at
  `test.celiador.ai`; the public DMG points at `celiador.ai`. Each environment
  has its own GoTrue, so a Test build signed in with a prod account sees
  nothing of the editor's sessions (and a prod session gets a 401 in it).
- Therefore the public group receives **only prod builds** (Release config →
  `celiador.ai`), never Test builds. Test builds stay with the `Internal`
  group, which has access to all builds and whose members know which channel
  they are on. The public group must **not** be created with
  `--access-all-builds`; every build it gets is added by hand.
- The first build added to an external group goes through Beta App Review
  before anyone outside the team can install it. The review needs the app's
  TestFlight review details (contact, sign-in instructions or a demo account:
  `asc --profile celiador testflight review view --app 6819707590`).

One-time steps (Stefan). The default `asc` profile on this Mac is the Celindor
team; the Celiador team (`XPNFDWPFAV`) is the stored profile named `celiador`,
selected with `--profile celiador` (or `ASC_PROFILE=celiador`; `asc auth status`
lists the profiles):

```sh
# 1. Create the external group "Public" with its public link on (no --internal,
#    no --access-all-builds). Optional: --public-link-limit-enabled --public-link-limit 1000.
asc --profile celiador testflight groups create --app 6819707590 --name Public --public-link-enabled --feedback-enabled --pretty
#    The response carries the group id and publicLink; to read them again later:
asc --profile celiador testflight groups list --app 6819707590 --external --output table
asc --profile celiador testflight groups view --id <GROUP_ID> --pretty
#    If the group already exists without the link: asc --profile celiador testflight groups edit --id <GROUP_ID> --public-link-enabled

# 2. Add the latest prod build to it and submit it for Beta App Review in one
#    go (--dry-run first shows what would be assigned). Check that --latest
#    really is a prod build (plain icon, started by hand), not a tag build:
#    asc --profile celiador builds list --app 6819707590 --limit 5 --output table
asc --profile celiador builds add-groups --app 6819707590 --latest --group Public --dry-run
asc --profile celiador builds add-groups --app 6819707590 --latest --group Public --submit --confirm
#    Or by build id: asc --profile celiador builds add-groups --build-id <BUILD_ID> --group Public --submit --confirm
#    Review status: asc --profile celiador builds beta-app-review-submission view --app 6819707590 --latest

# 3. Paste the publicLink into web/src/lib/site.ts (testflightUrl) and release
#    the site; the download page, /start, /docs and the FAQ switch from
#    "by invite" to the link.
```

For every later prod build that should reach the public: step 2 again (without
`--dry-run`). Nothing in the workflow adds a build to `Public`; that is
deliberate.

## Verifying the first build (ios#2 checklist)

- Install from TestFlight on the iPhone (the Dev and Test apps stay side by
  side with the App Store app: different bundle ids).
- Sign in against prod; the phone must appear in the editor's presence picker and
  receive a push when a run needs you (production APNs now, so the daemon's
  `APNS_ENV` must be `production` for this bundle id).
- Run through daemon#9's phone legs on this build.

## Versioning

`MARKETING_VERSION` lives in `project.yml` (app, widgets and watch must match
and equal the daemon's `package.json` version; the root `scripts/release.sh`
keeps them in step; the workflow refuses to build if they disagree). The
workflow sets `CURRENT_PROJECT_VERSION` to `1000 + run number` on the
command line, so the `"1"` in `project.yml` is only the local default. Xcode
Cloud's uploads were numbered 10–40, below that range.

## If a build fails

- *No signing certificate "iOS Distribution" found* / *no profiles*: the
  secrets are missing or stale → `ios/scripts/ci-signing-setup.sh` again.
- *SecKeychainItemImport: Unable to decode the provided data*: the p12 is a
  modern PKCS#12 (PBES2 / AES-256), which `security import` cannot read. The
  workflow re-wraps the identity with the legacy 3DES / SHA-1 algorithms
  before importing, and the setup script now emits that format; if you built
  a p12 by hand, add `-certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1`
  to `openssl pkcs12 -export`.
- *Cloud signing permission error* / *No profiles for '…' were found* at the
  export: the export fell back to automatic (cloud) signing, which needs an
  Admin key, or the named CI profiles are missing/expired → run
  `ios/scripts/ci-signing-setup.sh` again (it recreates them), or create them
  with `asc profiles create --profile-type IOS_APP_STORE` for the CI
  certificate.
- *Choose a certificate to revoke. Your account has reached the maximum number
  of certificates* at the archive: the runs minted a throwaway Apple
  Development certificate each (no `IOS_DEV_P12_BASE64`). Revoke the "Created
  via API" DEVELOPMENT certificates from App Store Connect → Certificates (or
  `asc --profile celiador certificates revoke --id … --confirm`; their keys
  lived only on ephemeral runners) and re-run `ios/scripts/ci-signing-setup.sh`
  so the workflow gets a persistent one.
- *Provisioning profile … doesn't include the … capability*: a capability was
  added to an App ID after its profile was made → regenerate the profiles (the
  setup script, or App Store Connect → Profiles → Edit → Save).
- *The bundle version must be higher*: a dispatch re-ran an old run number →
  just run again (the number is per run, not per attempt).
- *brew install xcodegen* network resets: the step retries four times; re-run
  the job if it still fails.
- Xcode mismatch (the project needs a newer SDK than the runner's): bump
  `DEVELOPER_DIR` in the workflow to another version listed in the runner
  image (github.com/actions/runner-images, `macos-26-Readme.md`), or switch
  `runs-on` to the `xcode-27` preview image.
