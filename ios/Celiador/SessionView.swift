import SwiftUI
import Observation

/// One row of the live transcript.
private struct TranscriptItem: Identifiable {
    enum Role { case user, assistant, tool, diff, error, note }
    let id: Int
    let role: Role
    var text: String
}

private struct PendingApproval: Equatable {
    let requestId: String
    let path: String
    let preview: String?
}

private struct PendingQuestion: Equatable {
    let requestId: String
    let prompt: String
}

/// Folds a session's live event stream into a transcript + control state. Owns
/// the SSE stream for the session that's open; steering actions post back to the
/// daemon, which the runner (editor) consumes.
@MainActor
@Observable
private final class SessionTranscript {
    var items: [TranscriptItem] = []
    var state: SessionState = .idle
    var runnerConnected = false
    var liveLine = ""
    var pendingApproval: PendingApproval?
    var pendingQuestion: PendingQuestion?
    var truncated = false

    private var sessionId = ""
    private weak var model: AppModel?
    private var stream: SessionEventStream?
    private var streamingId: Int?
    private var statusTask: Task<Void, Never>?

    func start(sessionId: String, model: AppModel) {
        guard stream == nil else { return }
        self.sessionId = sessionId
        self.model = model
        // runnerConnected isn't carried by the event stream, so keep polling it:
        // the composer unlocks when the editor attaches after the view opened.
        statusTask = Task { [weak self] in
            var first = true
            while !Task.isCancelled {
                if let s = try? await Api.shared.getSession(sessionId) {
                    if first { self?.state = s.state }
                    self?.runnerConnected = s.runnerConnected
                    first = false
                }
                try? await Task.sleep(for: .seconds(10))
            }
        }
        let s = SessionEventStream(sessionId: sessionId, since: 0) { [weak self] event in
            self?.ingest(event)
        }
        stream = s
        s.start()
    }

    func stop() {
        stream?.stop()
        stream = nil
        statusTask?.cancel()
        statusTask = nil
    }

    private func ingest(_ e: SessionEvent) {
        switch e.kind {
        case "message":
            let role: TranscriptItem.Role = e.role == "user" ? .user : .assistant
            items.append(.init(id: e.seq, role: role, text: e.text ?? ""))
            streamingId = nil
        case "delta":
            if let sid = streamingId, let idx = items.firstIndex(where: { $0.id == sid }) {
                items[idx].text += e.text ?? ""
            } else {
                items.append(.init(id: e.seq, role: .assistant, text: e.text ?? ""))
                streamingId = e.seq
            }
        case "tool":
            items.append(.init(id: e.seq, role: .tool, text: "→ " + e.toolSummary))
            streamingId = nil
        case "activity":
            liveLine = e.text ?? ""
            model?.noteActivity(sessionId: sessionId, text: liveLine)
        case "approval":
            if let rid = e.requestId {
                pendingApproval = PendingApproval(requestId: rid, path: e.path ?? "", preview: e.preview)
            }
            items.append(.init(id: e.seq, role: .note, text: "Wants to write \(e.path ?? "a file")"))
            streamingId = nil
        case "question":
            if let rid = e.requestId {
                pendingQuestion = PendingQuestion(requestId: rid, prompt: e.prompt ?? "")
            }
            streamingId = nil
        case "diff":
            let body = [e.path, e.patch].compactMap { $0 }.joined(separator: "\n")
            items.append(.init(id: e.seq, role: .diff, text: body))
            streamingId = nil
        case "error":
            items.append(.init(id: e.seq, role: .error, text: e.message ?? "Something went wrong."))
            streamingId = nil
        case "state":
            if let st = e.state {
                state = st
                if st != .awaiting { pendingApproval = nil; pendingQuestion = nil }
                if !st.isActive { liveLine = "" }
            }
        case "truncated":
            truncated = true
        default:
            break
        }
    }

    // MARK: - Steering (posts to the daemon → relayed to the editor)

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Task { try? await Api.shared.sendMessage(sessionId, text: trimmed) }
    }

    func resolve(_ approve: Bool) {
        guard let p = pendingApproval else { return }
        pendingApproval = nil // optimistic; the runner's next state event confirms
        Task { try? await Api.shared.resolveApproval(sessionId, requestId: p.requestId, approve: approve) }
    }

    func answer(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let q = pendingQuestion, !trimmed.isEmpty else { return }
        pendingQuestion = nil
        Task { try? await Api.shared.answer(sessionId, requestId: q.requestId, text: trimmed) }
    }

    func cancel() {
        Task { try? await Api.shared.cancelSession(sessionId) }
    }
}

struct SessionView: View {
    let sessionId: String

    @Environment(AppModel.self) private var model
    @State private var transcript = SessionTranscript()
    @State private var composer = ""
    @State private var answerText = ""

    private var title: String {
        model.sessions.first { $0.id == sessionId }?.title ?? "Session"
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if transcript.truncated {
                            Text("Earlier history isn't available.")
                                .font(.caption2)
                                .foregroundStyle(Theme.dim)
                                .frame(maxWidth: .infinity)
                        }
                        ForEach(transcript.items) { item in
                            row(item).id(item.id)
                        }
                        if transcript.state == .running, !transcript.liveLine.isEmpty {
                            HStack(spacing: 8) {
                                ProgressView().controlSize(.mini)
                                Text(transcript.liveLine)
                                    .font(.caption)
                                    .foregroundStyle(Theme.dim)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .id(-1)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: transcript.items.count) {
                    withAnimation { proxy.scrollTo(transcript.items.last?.id ?? -1, anchor: .bottom) }
                }
            }

            if let approval = transcript.pendingApproval {
                approvalCard(approval)
            }
            if let question = transcript.pendingQuestion {
                questionCard(question)
            }
            composerBar
        }
        .background(Theme.bg)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if transcript.state == .running {
                    Button(role: .destructive) { transcript.cancel() } label: {
                        Label("Stop", systemImage: "stop.circle")
                    }
                }
            }
        }
        .onAppear { transcript.start(sessionId: sessionId, model: model) }
        .onDisappear { transcript.stop() }
    }

    // MARK: - Transcript rows

    @ViewBuilder
    private func row(_ item: TranscriptItem) -> some View {
        switch item.role {
        case .user:
            Text(item.text)
                .font(.callout)
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Theme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .assistant:
            Text(item.text)
                .font(.callout)
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .tool:
            Text(item.text)
                .font(.caption.monospaced())
                .foregroundStyle(Theme.celadonBright)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .note:
            Text(item.text)
                .font(.caption)
                .foregroundStyle(Theme.attention)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .diff:
            Text(item.text)
                .font(.caption2.monospaced())
                .foregroundStyle(Theme.dim)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        case .error:
            Text(item.text)
                .font(.footnote)
                .foregroundStyle(Theme.red)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Steering surfaces

    private func approvalCard(_ approval: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("APPROVE WRITE")
                .font(.caption2.weight(.bold)).kerning(1)
                .foregroundStyle(Theme.attention)
            Text(approval.path)
                .font(.caption.monospaced())
                .foregroundStyle(Theme.ink)
            if let preview = approval.preview, !preview.isEmpty {
                Text(preview)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.dim)
                    .lineLimit(6)
            }
            HStack(spacing: 10) {
                Button { transcript.resolve(true) } label: {
                    Label("Allow", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(Theme.celadon)
                Button(role: .destructive) { transcript.resolve(false) } label: {
                    Label("Deny", systemImage: "xmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(14)
        .background(Theme.attention.opacity(0.08))
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Theme.border), alignment: .top)
    }

    private func questionCard(_ question: PendingQuestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(question.prompt)
                .font(.subheadline)
                .foregroundStyle(Theme.ink)
            HStack(spacing: 8) {
                TextField("Answer…", text: $answerText, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button {
                    transcript.answer(answerText)
                    answerText = ""
                } label: {
                    Image(systemName: "arrow.turn.down.left")
                }
                .buttonStyle(.borderedProminent).tint(Theme.attention)
                .disabled(answerText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(14)
        .background(Theme.attention.opacity(0.08))
        .overlay(Rectangle().frame(height: 1).foregroundStyle(Theme.border), alignment: .top)
    }

    private var composerBar: some View {
        let offline = !transcript.runnerConnected
        return HStack(alignment: .bottom, spacing: 8) {
            TextField(offline ? "Editor offline…" : "Send a follow-up…", text: $composer, axis: .vertical)
                .lineLimit(1...4)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.panel)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
                .disabled(offline)
            Button {
                transcript.send(composer)
                composer = ""
            } label: {
                Image(systemName: "arrow.up").font(.body.weight(.bold))
            }
            .buttonStyle(.borderedProminent)
            .disabled(offline || composer.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(12)
        .background(Theme.bg)
    }
}
