import Foundation

/// Remembers repo URLs the user has started cloud runs with (most-recent first),
/// so they can tap to reuse one instead of re-typing a long URL on the phone
/// keyboard. Local-only (UserDefaults) — recents are a convenience, not state the
/// daemon needs to know about.
enum RepoRecents {
    private static let key = "repoRecents"
    private static let max = 8

    static func list() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    /// Promote `url` to the front, de-duplicated (case-insensitive) and capped.
    static func remember(_ url: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var items = list().filter { $0.caseInsensitiveCompare(trimmed) != .orderedSame }
        items.insert(trimmed, at: 0)
        UserDefaults.standard.set(Array(items.prefix(max)), forKey: key)
    }

    static func forget(_ url: String) {
        UserDefaults.standard.set(
            list().filter { $0.caseInsensitiveCompare(url) != .orderedSame },
            forKey: key
        )
    }

    /// `owner/repo` for a GitHub-ish URL, else the raw string — for compact display.
    static func shortLabel(_ url: String) -> String {
        guard let comps = URLComponents(string: url) else { return url }
        let parts = comps.path.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return url }
        let repo = parts[1].hasSuffix(".git") ? String(parts[1].dropLast(4)) : parts[1]
        return "\(parts[0])/\(repo)"
    }
}
