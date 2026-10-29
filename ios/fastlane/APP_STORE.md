# App Store and TestFlight: what is where

The App Store record for Celiador (app id 6819707590, bundle `ai.celiador.companion`, team XPNFDWPFAV) is driven from this folder with fastlane, authenticated by the shared App Store Connect API key (`~/.appstoreconnect/private_keys/AuthKey_R73AU5822H.p8`). Builds come from Xcode Cloud (see `../TESTFLIGHT.md`); fastlane carries everything around the build.

| What | Where it lives | How it gets to Apple |
|---|---|---|
| Name, subtitle, description, keywords, promo text, URLs | `metadata/en-US/*.txt` | `fastlane metadata` |
| Categories, copyright | `metadata/*.txt` | `fastlane metadata` |
| App Review contact + demo account + notes | `.env` (secrets, gitignored) + `metadata/review_information/notes.txt` | `fastlane review_info` (App Store; Apple requires the phone) and `fastlane beta_info` / `fastlane external` (TestFlight) |
| Screenshots (iPhone 6.9") | `screenshots/en-US/` from `fastlane screenshots` | `fastlane upload_screenshots` |
| Age rating | none of the content categories apply | `fastlane age_rating` |
| TestFlight description, feedback email, privacy URL | Fastfile `beta_info` | `fastlane beta_info` |
| What to Test per build | `../testflight/WHAT_TO_TEST.md` | `asc builds test-notes create` (TESTFLIGHT.md) or the `external` lane's changelog |
| App privacy ("nutrition label") | `APP_PRIVACY.md` | App Store Connect website only; there is no API for it |

## First-time order

1. `cp .env.example .env`, fill in `REVIEW_PHONE` and `REVIEW_DEMO_PASSWORD` (the demo account `appreview@celiador.ai` exists on production).
2. `fastlane metadata`, `fastlane age_rating`, `fastlane review_info`, `fastlane beta_info` (done on 2026-10-24 except the two review contacts, which wait for `REVIEW_PHONE`).
3. `fastlane screenshots` then `fastlane upload_screenshots`.
4. App privacy on the website, from `APP_PRIVACY.md` (one time, about five minutes).
5. Public TestFlight: `BUILD=10 fastlane external` submits that build to Beta App Review and distributes it to the `External` group. Create the group once in App Store Connect → TestFlight → External Testing (enable the public link there; the API cannot create public links). Beta review takes a day or two the first time.
6. App Store release: version 1.0 is already created (state "Prepare for Submission"). Pick the build on the website or with `asc versions`, then submit. Release notes: `metadata/en-US/release_notes.txt`.

## Demo account for reviewers

`appreview@celiador.ai` on production. A reviewer with no computer online sees the account, the queue and history. Keep at least one finished run with a merged pull request on it so the review screens open; the loop test recipe in memory shows how to seed one from a throwaway editor session.
