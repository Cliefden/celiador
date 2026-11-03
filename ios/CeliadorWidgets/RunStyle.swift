import WidgetKit
import SwiftUI

/// How a run reads on the widget and the Live Activity: the same symbol and
/// tint as the app's run rows (`SessionRow`), so the three surfaces agree.
/// Keyed by strings because the widget only sees the snapshot's coarse bucket
/// and the Live Activity's pushed status label, not the app's `SessionState`.
struct RunTone: Equatable {
    let symbol: String
    let color: Color
    /// Sentence-case status, e.g. "Needs you".
    let label: String

    static let working = RunTone(symbol: "bolt.fill", color: Theme.accent, label: "Working")
    static let needsYou = RunTone(symbol: "hand.raised.fill", color: Theme.attention, label: "Needs you")
    static let failed = RunTone(symbol: "xmark", color: Theme.red, label: "Failed")
    static let done = RunTone(symbol: "checkmark", color: Theme.added, label: "Done")
    static let idle = RunTone(symbol: "minus", color: .gray, label: "Idle")

    /// The widget snapshot's bucket: "needs-you" | "working" | "ready" | "error".
    static func bucket(_ bucket: String) -> RunTone {
        switch bucket {
        case "working": return .working
        case "needs-you": return .needsYou
        case "error": return .failed
        case "ready": return .done
        default: return .idle
        }
    }

    /// The Live Activity's `statusLabel` (the daemon's and the app's
    /// `SessionState.label`: "working…", "needs you", "done", "failed", …).
    static func status(_ label: String) -> RunTone {
        switch label {
        case "needs you": return .needsYou
        case "failed": return .failed
        case "done": return .done
        case "cancelled": return RunTone(symbol: "minus", color: .gray, label: "Cancelled")
        case "idle": return .idle
        default: return .working
        }
    }
}

/// The app's `IconBadge` (DesignKit is app-only): a white symbol on a tinted
/// rounded square, scaled for widgets and the Dynamic Island.
struct RunBadge: View {
    var tone: RunTone
    var size: CGFloat = 28

    var body: some View {
        Image(systemName: tone.symbol)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(tone.color, in: RoundedRectangle(cornerRadius: size * 0.26, style: .continuous))
            .widgetAccentable()
            .accessibilityLabel(tone.label)
    }
}

/// The app's `StatusPill`: a sentence-case capsule with a tinted fill.
struct RunPill: View {
    var text: String
    var color: Color
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.caption2.weight(.semibold)) }
            Text(text).font(.caption2.weight(.semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(color.opacity(0.16), in: Capsule())
        .widgetAccentable()
    }
}
