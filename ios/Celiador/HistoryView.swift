import SwiftUI

/// Past conversations (durable chat history from the daemon's /api/chats). Tap one
/// to read its transcript. Presented as a sheet from the sessions list.
struct HistoryView: View {
    @State private var chats: [ChatSummary] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        content
        .background(CeliadorBackground())
        .navigationTitle("Activity")
        .navigationDestination(for: String.self) { id in ChatTranscriptView(chatId: id) }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            List {
                ForEach(0..<5, id: \.self) { _ in
                    SkeletonRow()
                }
            }
            .listStyle(.insetGrouped)
        } else if let error {
            EmptyStateView(icon: "exclamationmark.triangle", title: "Couldn't load history", message: error)
        } else if chats.isEmpty {
            EmptyStateView(
                icon: "clock.arrow.circlepath",
                title: "No past chats",
                message: "Conversations you run in Celiador are saved here so you can revisit them anytime."
            )
        } else {
            List(chats) { chat in
                NavigationLink(value: chat.id) { ChatRow(chat: chat) }
            }
            .listStyle(.insetGrouped)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        #if DEBUG
        if DemoData.isActive { chats = DemoData.chats; return }
        #endif
        do {
            chats = try await Api.shared.listChats()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ChatRow: View {
    let chat: ChatSummary

    private var badge: (icon: String, color: Color) {
        let s = chat.status.lowercased()
        if s.contains("error") || s.contains("fail") { return ("xmark", Theme.red) }
        if s.contains("await") || s.contains("need") { return ("hand.raised.fill", Theme.attention) }
        if s.contains("run") || s.contains("work") || s.contains("active") { return ("bolt.fill", .blue) }
        return ("text.bubble", .gray)
    }

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: badge.icon, color: badge.color)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(chat.title ?? "Untitled task")
                        .font(.body)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(RelativeTime.short(chat.updatedAt))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Text(chat.status.capitalized)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Read-only transcript of one past chat.
struct ChatTranscriptView: View {
    let chatId: String

    @State private var detail: ChatDetail?
    @State private var error: String?

    var body: some View {
        ZStack {
            CeliadorBackground()
            ScrollView {
                if let detail {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(detail.messages) { m in
                            if m.role.lowercased() == "user" {
                                Text(m.text)
                                    .font(.body)
                                    .foregroundStyle(.white)
                                    .textSelection(.enabled)
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .background(Theme.celadon, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    .frame(maxWidth: .infinity, alignment: .trailing)
                                    .padding(.leading, 48)
                            } else {
                                Text(m.text)
                                    .font(.body)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.trailing, 24)
                            }
                        }
                        if detail.messages.isEmpty {
                            Text("No messages in this chat.").foregroundStyle(.secondary).padding(.top, 20)
                        }
                    }
                    .padding()
                } else if let error {
                    EmptyStateView(icon: "exclamationmark.triangle", title: "Couldn't load chat", message: error)
                        .padding(.top, 60)
                } else {
                    VStack(spacing: 14) {
                        ForEach(0..<3, id: \.self) { _ in
                            VStack(alignment: .leading, spacing: 8) {
                                SkeletonBar(width: 60, height: 10)
                                SkeletonBar(height: 12)
                                SkeletonBar(width: 220, height: 12)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle(detail?.chat.title ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            detail = try await Api.shared.getChat(chatId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
