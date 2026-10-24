fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Push App Store metadata (text, URLs, categories, review information) for version 1.0. No binary, no screenshots.

### ios review_info

```sh
[bundle exec] fastlane ios review_info
```

App Store review contact + demo account + notes for version 1.0 (needs REVIEW_PHONE in fastlane/.env; Apple requires it).

### ios screenshots

```sh
[bundle exec] fastlane ios screenshots
```

Capture the App Store screenshot set (iPhone 6.9") from the simulator using the app's demo data.

### ios upload_screenshots

```sh
[bundle exec] fastlane ios upload_screenshots
```

Upload fastlane/screenshots to version 1.0 (replaces what is there).

### ios age_rating

```sh
[bundle exec] fastlane ios age_rating
```

Age rating: no objectionable content (4+).

### ios beta_info

```sh
[bundle exec] fastlane ios beta_info
```

TestFlight app description, feedback email, privacy URL, and Beta App Review contact + demo account.

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Build locally (automatic signing through the API key) and upload to TestFlight. Fallback for Xcode Cloud.

### ios external

```sh
[bundle exec] fastlane ios external
```

Submit a processed build (BUILD=<number>) to Beta App Review and distribute it to the External group.

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
