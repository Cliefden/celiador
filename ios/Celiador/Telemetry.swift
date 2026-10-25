import Foundation
import SwiftUI
import TelemetryDeck

/// Product telemetry, the phone half of the editor's TelemetryDeck appender:
/// same app id, so editor and phone land in one dashboard, and the same
/// discipline — a short allowlist of Celiador's own events, nothing else.
///
/// What leaves the phone: the event name, the parameters listed on each case
/// below, the app version, OS version and device model, and the SDK's default
/// user — a salted hash of `identifierForVendor`. Never: code, prompts, chat
/// content, repository names, branch names, paths, session ids, error
/// messages, or the account's email. Every parameter value comes from a fixed,
/// low-cardinality set (see docs/TELEMETRY.md for the catalogue).
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
    /// First launch of a build that has telemetry v2 — the retention anchor.
    static let installDateKey = "celiador.installDate"

    /// The events the phone may send, and what each carries.
    enum Event: String {
        // MARK: v1 (names and parameters frozen)

        /// A run was started from the phone on the editor's working copy. `seeded`: "true" when a first prompt went with it, "task" for a queued task.
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

        // MARK: v2

        /// Cold launch. `daysSinceInstall`: 0, 1-7, 8-30, 31+. `liveActivities`: on, off.
        case appLaunched = "celiador/appLaunched"
        /// A screen or sheet appeared. `screen`: see `Screen`.
        case screenViewed = "celiador/screenViewed"
        /// First time (per install) a funnel step is reached. `step`: see `OnboardingStep`. `daysSinceInstall`.
        case onboardingStep = "celiador/onboardingStep"
        /// The funnel's last step (first phone command) was reached. `daysSinceInstall`.
        case onboardingCompleted = "celiador/onboardingCompleted"
        /// Sign-in or sign-up failed. `method`: password, signUp, magicLink, github. `reason`: see `code(for:)`, or callbackInvalid.
        case signInFailed = "celiador/signInFailed"
        /// Sign-up succeeded but the account must be confirmed by email first.
        case signUpPendingConfirmation = "celiador/signUpPendingConfirmation"
        /// A magic sign-in link was emailed.
        case magicLinkSent = "celiador/magicLinkSent"
        /// The user signed out from Account.
        case signedOut = "celiador/signedOut"
        /// The account was deleted from Account.
        case accountDeleted = "celiador/accountDeleted"
        /// A system permission prompt was answered. `permission`: notifications. `result`: granted, denied.
        case permissionPrompt = "celiador/permissionPrompt"
        /// The app was opened from a re-engagement surface. `kind`: push, liveActivity, homeWidget, deepLink. `appState`: running, launching (push only).
        case notificationOpened = "celiador/notificationOpened"
        /// A Live Activity was started for a running session.
        case liveActivityStarted = "celiador/liveActivityStarted"
        /// A Live Activity ended. `reason`: awaiting, done, error, cancelled, idle, removed, signOut.
        case liveActivityEnded = "celiador/liveActivityEnded"
        /// A session's live transcript was opened. `state`: idle, running, awaiting, done, error, cancelled, unknown. `editor`: online, offline, cloud, unknown.
        case sessionOpened = "celiador/sessionOpened"
        /// An approval card was answered. `decision`: approve, deny. `tool`: write, shell, fetch, other. `latency`: see `latency(since:)`.
        case approvalResolved = "celiador/approvalResolved"
        /// An agent question was answered. `latency`.
        case questionAnswered = "celiador/questionAnswered"
        /// A cloud (server-side) run was started from New Run.
        case cloudRunStarted = "celiador/cloudRunStarted"
        /// The Changes sheet loaded. `mode`: live, transcript, liveUnavailable. `files`: 0, 1, 2-5, 6+.
        case changesViewed = "celiador/changesViewed"
        /// The run's changes were committed from the phone.
        case changesCommitted = "celiador/changesCommitted"
        /// One file's changes were discarded from the phone.
        case fileReverted = "celiador/fileReverted"
        /// A task's pull request was merged from the Queue swipe. `merged`: true, false.
        case pullRequestMerged = "celiador/pullRequestMerged"
        /// A "Ready for review" row was tapped to open the pull request in the browser.
        case pullRequestLinkOpened = "celiador/pullRequestLinkOpened"
        /// A queued or running task was cancelled from the Queue.
        case taskCancelled = "celiador/taskCancelled"
        /// A repo was watched or unwatched for GitHub-issue tasks. `watched`: true, false.
        case repoWatchToggled = "celiador/repoWatchToggled"
        /// A session was deleted from the Agents list.
        case sessionDeleted = "celiador/sessionDeleted"
        /// A file edited in Explorer was saved back to the workspace.
        case fileSaved = "celiador/fileSaved"
        /// A real failure (never a cancellation). `domain`: see `ErrorDomain`. `operation`: fixed per call site. `code`: see `code(for:)`.
        case error = "celiador/error"
    }

    /// `screen` values for `screenViewed`.
    enum Screen: String {
        case login, unreachable
        case queue, agents, explorer, activity
        case session, changes, commit, pullRequest
        case newRun, newRunCompose, newTask, watchedRepos
        case account, codeFile, chatTranscript
    }

    /// The pairing funnel, in order. Each fires at most once per install.
    enum OnboardingStep: String {
        case signInShown, signedIn, editorPaired, firstSessionMirrored, firstSessionOpened, firstPhoneCommand
    }

    /// `domain` values for `error`.
    enum ErrorDomain: String {
        case config, relay, sessions, run, tasks, git, files, push, liveActivity, history, profile, account
    }

    // MARK: - Buckets

    /// Bucket a count so small numbers don't fingerprint anyone.
    static func bucket(_ n: Int) -> String {
        switch n {
        case 0: "0"
        case 1: "1"
        case 2...5: "2-5"
        default: "6+"
        }
    }

    /// How long the user took to act: <10s, 10-60s, 1-5m, 5-60m, 1h+.
    static func latency(since start: Date) -> String {
        switch Date().timeIntervalSince(start) {
        case ..<10: "<10s"
        case ..<60: "10-60s"
        case ..<300: "1-5m"
        case ..<3600: "5-60m"
        default: "1h+"
        }
    }

    /// Days since the install anchor: 0, 1-7, 8-30, 31+.
    static var daysSinceInstall: String {
        guard let installed = UserDefaults.standard.object(forKey: installDateKey) as? Date else { return "0" }
        let days = Calendar.current.dateComponents([.day], from: installed, to: Date()).day ?? 0
        switch days {
        case ..<1: return "0"
        case 1...7: return "1-7"
        case 8...30: return "8-30"
        default: return "31+"
        }
    }

    /// A short, fixed code for an error — never its message. `nil` for
    /// cancellations, which aren't failures.
    static func code(for error: Error) -> String? {
        if error is CancellationError { return nil }
        if let e = error as? URLError {
            switch e.code {
            case .cancelled: return nil
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff: return "offline"
            case .timedOut: return "timeout"
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed: return "unreachable"
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot: return "tls"
            default: return "network"
            }
        }
        if let e = error as? Api.ApiError {
            if let status = e.status { return "http\(status)" }
            return "client"
        }
        if error is DecodingError { return "decode" }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { return ns.code == NSURLErrorCancelled ? nil : "network" }
        return "other"
    }

    // MARK: - Sending

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
        if UserDefaults.standard.object(forKey: installDateKey) == nil {
            UserDefaults.standard.set(Date(), forKey: installDateKey)
        }
    }

    static func signal(_ event: Event, _ parameters: [String: String] = [:]) {
        guard isEnabled else { return }
        TelemetryDeck.signal(event.rawValue, parameters: parameters)
    }

    /// Record a failure as `celiador/error`. Cancellations are dropped.
    static func error(_ domain: ErrorDomain, _ operation: String, _ error: Error) {
        guard let code = code(for: error) else { return }
        self.error(domain, operation, code: code)
    }

    /// Record a failure with an explicit code (for failures that aren't a thrown error).
    static func error(_ domain: ErrorDomain, _ operation: String, code: String) {
        signal(.error, ["domain": domain.rawValue, "operation": operation, "code": code])
    }

    /// Mark a funnel step reached; only the first time per install sends.
    static func onboarding(_ step: OnboardingStep) {
        let key = "celiador.telemetry.onboarding.\(step.rawValue)"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        let days = daysSinceInstall
        signal(.onboardingStep, ["step": step.rawValue, "daysSinceInstall": days])
        if step == .firstPhoneCommand {
            signal(.onboardingCompleted, ["daysSinceInstall": days])
        }
    }

    /// Dev and Staging install side by side with their own bundle id suffix.
    private static var isTestChannel: Bool {
        let id = Bundle.main.bundleIdentifier ?? ""
        return id.hasSuffix(".dev") || id.hasSuffix(".staging")
    }
}

extension View {
    /// Send `celiador/screenViewed` each time this view appears.
    func trackScreen(_ screen: Telemetry.Screen) -> some View {
        onAppear { Telemetry.signal(.screenViewed, ["screen": screen.rawValue]) }
    }
}
