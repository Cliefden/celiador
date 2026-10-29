import WidgetKit
import SwiftUI
import ActivityKit

/// Lock-screen banner + Dynamic Island for a chat the agent is actively working
/// on. Content is driven by the app (foreground) and by APNs `liveactivity`
/// push (suspended) — both replace the same `ContentState`.
struct ChatLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ChatActivityAttributes.self) { context in
            lockScreen(context)
                .activityBackgroundTint(Theme.bg)
                .activitySystemActionForegroundColor(Theme.accentBright)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "hammer.fill").foregroundStyle(Theme.accentBright)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.sessionTitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(liveText(context))
                        .font(.caption2)
                        .foregroundStyle(Theme.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            } compactLeading: {
                Image(systemName: "hammer.fill").foregroundStyle(Theme.accentBright)
            } compactTrailing: {
                ProgressView().controlSize(.mini).tint(Theme.accent)
            } minimal: {
                Image(systemName: "hammer.fill").foregroundStyle(Theme.accentBright)
            }
            .widgetURL(URL(string: AppScheme.session(context.attributes.sessionId)))
        }
    }

    private func liveText(_ context: ActivityViewContext<ChatActivityAttributes>) -> String {
        let text = context.state.activityText
        return text.isEmpty ? context.state.statusLabel : text
    }

    private func lockScreen(_ context: ActivityViewContext<ChatActivityAttributes>) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "hammer.fill")
                .foregroundStyle(Theme.accentBright)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.sessionTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(liveText(context))
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
            ProgressView().controlSize(.small).tint(Theme.accent)
        }
        .padding(14)
    }
}
