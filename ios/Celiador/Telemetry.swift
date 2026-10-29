import Foundation
import TelemetryDeck

/// Product telemetry, the phone half of the editor's TelemetryDeck appender:
/// same app id, so editor and phone land in one dashboard, and the same
/// discipline — a short allowlist of Celiador's own events, nothing else.
///
/// What leaves the phone: the event name, the parameters listed on each case
/// below, the app version, OS version and device model, and the SDK's default
/// user — a salted hash of `identifierForVendor`. Never: code, prompts, chat
/// content, repository names, paths, session ids, or the account's email.
///
/// Off switch: `isEnabled`, surfaced as "Share anonymous usage data" in
/// Account. The Dev app and any build pointed at a non-prod daemon (a Test
/// build on TestFlight) send in test mode so dogfood signals stay out of the
/// production view. Lives in the app target on purpose — `Shared/`
/// must stay dependency-free for the widgets.
enum Telemetry {
    /// The same TelemetryDeck app as the editor (`product.json` → `telemetryDeck.appId`).
    static let appId = "F1064ED9-9413-4478-8753-20DC53104F78"
    /// UserDefaults key behind the Account toggle; absent means on.
    static let enabledKey = "celiador.telemetry.enabled"

    /// The events the phone may send, and what each carries.
    enum Event: String {
        /// A run was started from the phone on the editor's working copy. `seeded`: "true" when a first prompt went with it.
        case phoneRun = "celiador/phoneRun"
        /// A steering command was sent to a running session. `command`: instruct, approve, reject, answer, cancel.
        case phoneCommand = "celiador/phoneCommand"
        /// Push + pull request from the Changes view. `created`: "true" when the PR was opened, "false" for a compare link.
        case phonePullRequest = "celiador/phonePullRequest"
        /// Sign-in completed. `method`: password, magicLink, github.
        case signedIn = "celiador/signedIn"
        /// A past chat was opened from Activity. `result`: loaded, failed.
        case chatOpened = "celiador/chatOpened"
        /// The New Run sheet loaded its "From your editor" list. `editorRepos`: 0, 1, 2-5, 6+.
        case newRunOpened = "celiador/newRunOpened"
    }

    /// Bucket a count so small numbers don't fingerprint anyone.
    static func bucket(_ n: Int) -> String {
        switch n {
        case 0: "0"
        case 1: "1"
        case 2...5: "2-5"
        default: "6+"
        }
    }

    private static let config = TelemetryDeck.Config(appID: appId)

    static var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: enabledKey)
            config.analyticsDisabled = !newValue
        }
    }

    /// Call once at launch, before any signal.
    static func configure() {
        config.testMode = isTestChannel
        config.analyticsDisabled = !isEnabled
        TelemetryDeck.initialize(config: config)
    }

    static func signal(_ event: Event, _ parameters: [String: String] = [:]) {
        guard isEnabled else { return }
        TelemetryDeck.signal(event.rawValue, parameters: parameters)
    }

    /// The Dev app has its own bundle id suffix; the Test build is the prod
    /// bundle pointed at test.celiador.ai (CHANNELS.md), so the daemon host is
    /// what tells a dogfood build from the real thing.
    private static var isTestChannel: Bool {
        let id = Bundle.main.bundleIdentifier ?? ""
        if id.hasSuffix(".dev") { return true }
        return Api.shared.baseURL.host != "celiador.ai"
    }
}
