import WidgetKit
import SwiftUI
import ActivityKit

/// Lock-screen banner + Dynamic Island for a run the agent is actively working
/// on. Content is driven by the app (foreground) and by APNs `liveactivity`
/// push (suspended) — both replace the same `ContentState`, so the badge
/// follows the pushed status (a run that starts waiting on you turns amber
/// while the app is asleep).
struct ChatLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ChatActivityAttributes.self) { context in
            RunActivityLockScreen(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Theme.bg)
                .activitySystemActionForegroundColor(Theme.accent)
        } dynamicIsland: { context in
            let tone = RunTone.status(context.state.statusLabel)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RunBadge(tone: tone, size: 36)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let started = context.attributes.startedAt {
                        ElapsedText(since: started)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(tone.color)
                            .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(context.attributes.sessionTitle)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(RunActivityLockScreen.subtitle(tone: tone, runner: context.attributes.runner))
                            .font(.caption)
                            .foregroundStyle(tone == .needsYou ? Theme.attention : .secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(RunActivityLockScreen.liveText(context.state))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: tone.symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tone.color)
            } compactTrailing: {
                if let started = context.attributes.startedAt, tone == .working {
                    ElapsedText(since: started)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(tone.color)
                        .frame(maxWidth: 44)
                } else {
                    Text(tone.label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(tone.color)
                }
            } minimal: {
                Image(systemName: tone.symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tone.color)
            }
            .keylineTint(tone.color)
            .widgetURL(URL(string: AppScheme.session(context.attributes.sessionId, source: "liveActivity")))
        }
    }
}

/// The lock-screen banner, independent of `ActivityViewContext` so it can be
/// previewed: a tinted state badge, the run's title and where it runs, the live
/// elapsed timer, and the agent's latest line.
struct RunActivityLockScreen: View {
    let attributes: ChatActivityAttributes
    let state: ChatActivityAttributes.ContentState

    static func liveText(_ state: ChatActivityAttributes.ContentState) -> String {
        state.activityText.isEmpty ? state.statusLabel : state.activityText
    }

    /// "Working on your Mac" / "Needs you · in the cloud".
    static func subtitle(tone: RunTone, runner: String?) -> String {
        let place: String? = switch runner {
        case "server": "in the cloud"
        case "editor": "on your Mac"
        default: nil
        }
        guard let place else { return tone.label }
        return tone == .working ? "\(tone.label) \(place)" : "\(tone.label) · \(place)"
    }

    var body: some View {
        let tone = RunTone.status(state.statusLabel)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                RunBadge(tone: tone, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(attributes.sessionTitle)
                        .font(.headline)
                        .lineLimit(1)
                    Text(Self.subtitle(tone: tone, runner: attributes.runner))
                        .font(.subheadline)
                        .foregroundStyle(tone == .needsYou ? Theme.attention : .secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if let started = attributes.startedAt {
                    ElapsedText(since: started)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(tone.color)
                }
            }
            Text(Self.liveText(state))
                .font(.footnote.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(Theme.panelHi.opacity(0.7), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
        }
        .padding(16)
    }
}

/// A live "4:12" counting up from `since`, rendered by the system (no updates needed).
struct ElapsedText: View {
    let since: Date

    var body: some View {
        Text(since, style: .timer)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
    }
}

#if DEBUG
private let previewAttributes = ChatActivityAttributes(
    sessionId: "s4", sessionTitle: "Migrate API client to async/await",
    startedAt: Date().addingTimeInterval(-252), runner: "editor"
)

#Preview("Lock screen", as: .content, using: previewAttributes) {
    ChatLiveActivity()
} contentStates: {
    ChatActivityAttributes.ContentState(statusLabel: "working…", activityText: "Running tests: 24 passed, 2 remaining")
    ChatActivityAttributes.ContentState(statusLabel: "needs you", activityText: "Run command: npm test -- relay")
}

#Preview("Dynamic Island", as: .dynamicIsland(.expanded), using: previewAttributes) {
    ChatLiveActivity()
} contentStates: {
    ChatActivityAttributes.ContentState(statusLabel: "working…", activityText: "Running tests: 24 passed, 2 remaining")
}
#endif
