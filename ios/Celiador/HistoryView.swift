import SwiftUI

/// Past conversations (durable chat history from the daemon's /api/chats). Tap one
/// to read its transcript. Presented as a sheet from the sessions list.
struct HistoryView: View {
    @State private var chats: [ChatSummary] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ZStack {
            CeliadorBackground()
            content
        }
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: String.self) { id in ChatTranscriptView(chatId: id) }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            List {
                ForEach(0..<5, id: \.self) { _ in
                    SkeletonRow().listRowBackground(Theme.panel)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
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
                    .listRowBackground(Theme.panel)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
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

    private var statusColor: Color {
        let s = chat.status.lowercased()
        if s.contains("error") || s.contains("fail") { return Theme.red }
        if s.contains("await") || s.contains("need") { return Theme.attention }
        if s.contains("run") || s.contains("work") || s.contains("active") { return Theme.celadonBright }
        return Theme.faint
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            StatusDot(color: statusColor, size: 9).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(chat.title ?? "Untitled task")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(RelativeTime.short(chat.updatedAt))
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.faint)
                }
                Text(chat.status.capitalized)
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
            }
        }
        .padding(.vertical, 5)
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
                            VStack(alignment: .leading, spacing: 5) {
                                StatusPill(text: m.role,
                                           color: m.role.lowercased() == "user" ? Theme.celadonBright : Theme.dim)
                                Text(m.text)
                                    .font(.callout)
                                    .foregroundStyle(Theme.ink)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.panel.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.hairline, lineWidth: 1))
                        }
                        if detail.messages.isEmpty {
                            Text("No messages in this chat.").foregroundStyle(Theme.dim).padding(.top, 20)
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
                            .background(Theme.panel.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
