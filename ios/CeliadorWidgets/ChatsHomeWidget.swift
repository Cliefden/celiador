import WidgetKit
import SwiftUI

/// Home Screen widget: a glance at how many runs want you and which ones are
/// live. Reads only the App Group snapshot the app publishes — no network.
struct ChatsHomeWidget: Widget {
    var body: some WidgetConfiguration {
        // The kind keeps its old name so widgets people already placed survive.
        StaticConfiguration(kind: "CeliadorChats", provider: ChatsProvider()) { entry in
            ChatsWidgetView(snapshot: entry.snapshot)
                .containerBackground(Theme.bg, for: .widget)
        }
        .configurationDisplayName("Celiador Runs")
        .description("See which runs need you and what the agent is working on.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct ChatsEntry: TimelineEntry {
    let date: Date
    let snapshot: ChatSnapshot
}

struct ChatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> ChatsEntry {
        ChatsEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (ChatsEntry) -> Void) {
        completion(ChatsEntry(date: Date(), snapshot: SharedStore.readSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ChatsEntry>) -> Void) {
        let entry = ChatsEntry(date: Date(), snapshot: SharedStore.readSnapshot())
        // The app reloads the timeline on refresh; this cadence is a safety net.
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

/// The widget in the app's iOS 26 language: SF Pro, a large count like the app's
/// large titles, Settings-style tinted badges per run, sentence-case pills.
struct ChatsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: ChatSnapshot

    var body: some View {
        switch family {
        case .systemSmall: small
        default: medium
        }
    }

    /// What the big number counts: attention first, then live work.
    private var lead: (count: Int, tone: RunTone, caption: String)? {
        if snapshot.needsYou > 0 { return (snapshot.needsYou, .needsYou, snapshot.needsYou == 1 ? "needs you" : "need you") }
        if snapshot.working > 0 { return (snapshot.working, .working, "working") }
        return nil
    }

    private var brand: some View {
        Text("Celiador")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
    }

    // MARK: Small

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                brand
                Spacer(minLength: 0)
                RunBadge(tone: lead?.tone ?? .done, size: 24)
            }
            Spacer(minLength: 4)
            if let lead {
                Text("\(lead.count)")
                    .font(.system(size: 40, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(lead.tone.color)
                    .widgetAccentable()
                    .contentTransition(.numericText())
                Text(lead.caption)
                    .font(.subheadline.weight(.semibold))
                if let top = snapshot.items.first {
                    Text(top.name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .padding(.top, 2)
                }
            } else {
                allClear
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(snapshot.items.first.map { URL(string: AppScheme.session($0.id, source: "homeWidget"))! }
                   ?? URL(string: AppScheme.queue))
    }

    private var allClear: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("All clear")
                .font(.title3.weight(.semibold))
            Text("No runs need you.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Medium

    private var medium: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                brand
                Spacer(minLength: 0)
                if snapshot.needsYou > 0 {
                    RunPill(text: "\(snapshot.needsYou) need\(snapshot.needsYou == 1 ? "s" : "") you", color: Theme.attention, icon: "hand.raised.fill")
                }
                if snapshot.working > 0 {
                    RunPill(text: "\(snapshot.working) working", color: Theme.accent, icon: "bolt.fill")
                }
            }
            if snapshot.items.isEmpty {
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    RunBadge(tone: .done, size: 32)
                    allClear
                }
                Spacer(minLength: 0)
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(snapshot.items.prefix(3)) { item in
                        row(item)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: AppScheme.queue))
    }

    private func row(_ item: ChatSnapshotItem) -> some View {
        Link(destination: URL(string: AppScheme.session(item.id, source: "homeWidget"))!) {
            HStack(spacing: 10) {
                RunBadge(tone: .bucket(item.bucket), size: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(item.detail)
                        .font(.caption)
                        .foregroundStyle(item.bucket == "needs-you" ? Theme.attention : .secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

#if DEBUG
extension ChatSnapshot {
    /// Sample snapshot for previews: one run waiting on you, two working.
    static let preview = ChatSnapshot(needsYou: 1, working: 2, items: [
        ChatSnapshotItem(id: "s1", name: "Refactor auth middleware", bucket: "needs-you", detail: "needs you"),
        ChatSnapshotItem(id: "s3", name: "Add dark-mode toggle to settings", bucket: "working", detail: "Editing SettingsView.swift"),
        ChatSnapshotItem(id: "s4", name: "Migrate API client to async/await", bucket: "working", detail: "Running tests: 24 passed"),
    ], updatedAt: Date())
}

#Preview("Small", as: .systemSmall) {
    ChatsHomeWidget()
} timeline: {
    ChatsEntry(date: Date(), snapshot: .preview)
    ChatsEntry(date: Date(), snapshot: .empty)
}

#Preview("Medium", as: .systemMedium) {
    ChatsHomeWidget()
} timeline: {
    ChatsEntry(date: Date(), snapshot: .preview)
    ChatsEntry(date: Date(), snapshot: .empty)
}
#endif
