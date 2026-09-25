import SwiftUI

/// Past conversations (durable chat history from the daemon's /api/chats). Tap one
/// to read its transcript. Presented as a sheet from the sessions list.
struct HistoryView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var chats: [ChatSummary] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView("Couldn't load history", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if chats.isEmpty {
                    ContentUnavailableView(
                        "No past chats",
                        systemImage: "clock",
                        description: Text("Conversations you run in Celiador show up here.")
                    )
                } else {
                    List(chats) { chat in
                        NavigationLink(value: chat.id) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(chat.title ?? "Untitled task")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(1)
                                Text(chat.status)
                                    .font(.caption)
                                    .foregroundStyle(Theme.dim)
                            }
                        }
                        .listRowBackground(Theme.panel)
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.bg)
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in ChatTranscriptView(chatId: id) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            chats = try await Api.shared.listChats()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Read-only transcript of one past chat.
struct ChatTranscriptView: View {
    let chatId: String

    @State private var detail: ChatDetail?
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let detail {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(detail.messages) { m in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(m.role.uppercased())
                                .font(.caption2.weight(.bold))
                                .kerning(1)
                                .foregroundStyle(Theme.dim)
                            Text(m.text)
                                .foregroundStyle(Theme.ink)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if detail.messages.isEmpty {
                        Text("No messages in this chat.").foregroundStyle(Theme.dim)
                    }
                }
                .padding()
            } else if let error {
                Text(error).font(.footnote).foregroundStyle(Theme.red).padding()
            } else {
                ProgressView().padding(40)
            }
        }
        .background(Theme.bg)
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
