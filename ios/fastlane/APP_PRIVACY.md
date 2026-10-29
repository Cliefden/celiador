# App privacy answers (App Store Connect → App Privacy)

There is no API for the privacy "nutrition label"; enter these on the website once. They match `celiador.ai/privacy` and what the code does.

**Do you or your third-party partners collect data from this app?** Yes.

| Data type | Collected | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality (account sign-in) |
| Identifiers → User ID | Yes | Yes | No | App Functionality (account) |
| Usage Data → Product Interaction | Yes | No | No | Analytics (TelemetryDeck, anonymous; the user can switch it off in Account) |
| Diagnostics → Crash Data | Yes | No | No | Analytics (TelemetryDeck, anonymous) |

Not collected: name, phone, location, contacts, photos, purchases, browsing or search history, device identifiers for advertising, health, financial info, messages (agent transcripts are not stored by the app; they are relayed from the user's own computer and kept under the user's account per the privacy policy).

**Tracking** (data linked with third-party data for advertising or measurement): No. No ad SDKs, no fingerprinting.

**Third parties:** TelemetryDeck (analytics, EU-hosted, no personal data); Apple Push Notification service (push tokens, app functionality). Anthropic receives the content of agent runs through celiador.ai, which is covered by the privacy policy's "How AI requests work" section, not by the app's data collection label (the request is made by the user's computer, not the phone).

**Age rating:** no objectionable content in any category → 4+ (`fastlane age_rating`).

**Export compliance:** the app uses only standard HTTPS/TLS; `ITSAppUsesNonExemptEncryption` is false in the Info.plist, so no export documentation is needed.
