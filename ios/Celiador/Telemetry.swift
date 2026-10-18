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
/// Account. Dev and Staging builds send in test mode so dogfood signals stay
/// out of the production view. Lives in the app target on purpose — `Shared/`
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

    /// Dev and Staging install side by side with their own bundle id suffix.
    private static var isTestChannel: Bool {
        let id = Bundle.main.bundleIdentifier ?? ""
        return id.hasSuffix(".dev") || id.hasSuffix(".staging")
    }
}
