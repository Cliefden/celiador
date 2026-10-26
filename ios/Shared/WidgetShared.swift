import Foundation

// Types shared by the app and the widget extension: the Live Activity contract
// and the App Group snapshot the Home Screen widget reads. Kept dependency-free
// (no Api/AppModel) so the widget target can include it without pulling the app.

// MARK: - URL scheme (channel-aware deep links)

/// The app's custom URL scheme for this build channel — `celiador`,
/// `celiador-dev`, or `celiador-staging`. Read from Info.plist (populated from
/// the xcconfig's `URL_SCHEME` via the `CELIADOR_URL_SCHEME` key) so the app and
/// widget agree per channel and deep links open the matching installed app —
/// otherwise a Dev build's magic link / widget tap would target the prod app.
/// Falls back to `celiador`.
enum AppScheme {
    static let scheme: String = {
        if let s = Bundle.main.object(forInfoDictionaryKey: "CELIADOR_URL_SCHEME") as? String,
           !s.isEmpty {
            return s
        }
        return "celiador"
    }()

    /// `celiador[-channel]://auth-callback` — the magic-link / OAuth return URL.
    static var authCallback: String { "\(scheme)://auth-callback" }

    /// `celiador[-channel]://session/<id>` — deep link to a session (widgets, push).
    static func session(_ id: String) -> String { "\(scheme)://session/\(id)" }

    /// `celiador[-channel]://task/<id>` — an agent task's run screen on the Queue tab.
    static func task(_ id: String) -> String { "\(scheme)://task/\(id)" }

    /// `celiador[-channel]://queue` — the Queue tab.
    static var queue: String { "\(scheme)://queue" }
}

// MARK: - Live Activity (iOS only — ActivityKit is unavailable on macOS)

#if os(iOS)
import ActivityKit

/// A running session's live status on the lock screen / Dynamic Island. The
/// static attributes identify the session; `ContentState` carries what changes as
/// the agent works and is what push updates replace.
struct ChatActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Human status, e.g. "working…" (from `SessionState.label`).
        var statusLabel: String
        /// The agent's latest live line, e.g. "reading package.json…".
        var activityText: String
    }

    var sessionId: String
    var sessionTitle: String
}
#endif

// MARK: - Home Screen widget snapshot (App Group)

/// One chat as shown by the Home Screen widget.
struct ChatSnapshotItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    /// Coarse bucket the widget colors on: "needs-you" | "working" | "ready" | "error".
    var bucket: String
    var detail: String
}

/// Compact projects summary the app publishes for the widget. No network or
/// auth happens in the widget — it only renders this.
struct ChatSnapshot: Codable {
    var needsYou: Int
    var working: Int
    var items: [ChatSnapshotItem]
    var updatedAt: Date

    static let empty = ChatSnapshot(needsYou: 0, working: 0, items: [], updatedAt: .distantPast)
}

/// Read/write the widget snapshot in the shared App Group container.
enum SharedStore {
    static let appGroup = "group.ai.celiador.companion"
    private static let file = "chat-snapshot.json"

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    static func writeSnapshot(_ snapshot: ChatSnapshot) {
        guard let url = containerURL?.appendingPathComponent(file),
              let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func readSnapshot() -> ChatSnapshot {
        guard let url = containerURL?.appendingPathComponent(file),
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(ChatSnapshot.self, from: data)
        else { return .empty }
        return snapshot
    }
}
