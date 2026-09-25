import WidgetKit
import SwiftUI

/// Home Screen widget: a glance at how many chats want you and which ones are
/// live. Reads only the App Group snapshot the app publishes — no network.
struct ChatsHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CeliadorChats", provider: ChatsProvider()) { entry in
            ChatsWidgetView(snapshot: entry.snapshot)
                .containerBackground(Theme.bg, for: .widget)
        }
        .configurationDisplayName("Celiador Chats")
        .description("See which chats need you and what the agent is working on.")
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

struct ChatsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: ChatSnapshot

    var body: some View {
        switch family {
        case .systemSmall: small
        default: medium
        }
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Celiador")
                .font(.system(size: 15, design: .serif).italic())
                .foregroundStyle(Theme.celadonBright)
            if snapshot.needsYou > 0 {
                Text("\(snapshot.needsYou) need\(snapshot.needsYou == 1 ? "s" : "") you")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.attention)
            } else if snapshot.working > 0 {
                Text("\(snapshot.working) working")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.celadon)
            } else {
                Text("all clear")
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
            }
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            headline
            Spacer(minLength: 0)
            if let top = snapshot.items.first {
                row(top)
            }
        }
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 6) {
            headline
            Spacer(minLength: 0)
            ForEach(snapshot.items.prefix(3)) { item in
                row(item)
            }
            if snapshot.items.isEmpty {
                Text("No chats yet.")
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
            }
        }
    }

    private func row(_ item: ChatSnapshotItem) -> some View {
        Link(destination: URL(string: "celiador://session/\(item.id)")!) {
            HStack(spacing: 8) {
                Circle().fill(WidgetColor.dot(item.bucket)).frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(item.detail).font(.caption2).foregroundStyle(Theme.dim).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
    }
}
