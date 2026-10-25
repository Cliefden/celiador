import SwiftUI
import Observation

/// One row of the live transcript.
private struct TranscriptItem: Identifiable {
    enum Role { case user, assistant, tool, diff, error, note }
    let id: Int
    let role: Role
    var text: String
}

/// One changed file produced during the run (for the Changes / git-review view).
struct DiffFile: Identifiable, Equatable {
    let id: Int
    let path: String
    let patch: String
}

private struct PendingApproval: Equatable {
    let requestId: String
    /// Tool kind/name the agent wants to run (write_file, edit, bash, fetch, …).
    let kind: String
    /// Human-readable description of what will happen.
    let label: String
    let preview: String?
    /// When the card appeared on the phone — for the decision-latency bucket.
    var shownAt = Date()
}

private struct PendingQuestion: Equatable {
    let requestId: String
    let prompt: String
    var shownAt = Date()
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
    /// Every changed file the run has produced, for the Changes (git-review) view.
    var diffs: [DiffFile] = []

    private var sessionId = ""
    private weak var model: AppModel?
    private var stream: SessionEventStream?
    private var streamingId: Int?
    private var statusTask: Task<Void, Never>?
    /// tool callId → transcript item id, so a toolResult can mark its tool line done.
    private var toolItemByCallId: [String: Int] = [:]
    private var reportedStreamFailure = false

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
        let s = SessionEventStream(sessionId: sessionId, since: 0, onEvent: { [weak self] event in
            self?.ingest(event)
        }, onFailure: { [weak self] error in
            // Once per open session: the stream retries with backoff on its own.
            guard let self, !self.reportedStreamFailure else { return }
            self.reportedStreamFailure = true
            Telemetry.error(.relay, "eventStream", error)
        })
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
            if let cid = e.callId { toolItemByCallId[cid] = e.seq }
            streamingId = nil
        case "toolResult":
            // Mark the matching tool line done (✓ ok / ✗ failed).
            if let cid = e.callId, let itemId = toolItemByCallId[cid],
               let idx = items.firstIndex(where: { $0.id == itemId }) {
                let mark = (e.ok ?? false) ? "  ✓" : "  ✗"
                if !items[idx].text.hasSuffix(mark) { items[idx].text += mark }
            }
        case "activity":
            liveLine = e.text ?? ""
            model?.noteActivity(sessionId: sessionId, text: liveLine)
        case "approval":
            let kind = e.approvalKind ?? "tool"
            // Prefer the server's human-readable title; fall back to path (write/edit) or kind.
            let label = e.title ?? e.path.map { "Write \($0)" } ?? "Run \(kind)"
            if let rid = e.requestId {
                pendingApproval = PendingApproval(requestId: rid, kind: kind, label: label, preview: e.preview)
            }
            items.append(.init(id: e.seq, role: .note, text: "Needs approval — \(label)"))
            streamingId = nil
        case "question":
            if let rid = e.requestId {
                pendingQuestion = PendingQuestion(requestId: rid, prompt: e.prompt ?? "")
            }
            streamingId = nil
        case "diff":
            let body = [e.path, e.patch].compactMap { $0 }.joined(separator: "\n")
            items.append(.init(id: e.seq, role: .diff, text: body))
            diffs.append(DiffFile(id: e.seq, path: e.path ?? "(file)", patch: e.patch ?? ""))
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
        command("instruct") { [sessionId] in try await Api.shared.sendMessage(sessionId, text: trimmed) }
    }

    func resolve(_ approve: Bool) {
        guard let p = pendingApproval else { return }
        pendingApproval = nil // optimistic; the runner's next state event confirms
        Telemetry.signal(.approvalResolved, [
            "decision": approve ? "approve" : "deny",
            "tool": Self.toolBucket(p.kind),
            "latency": Telemetry.latency(since: p.shownAt),
        ])
        command(approve ? "approve" : "reject") { [sessionId] in
            try await Api.shared.resolveApproval(sessionId, requestId: p.requestId, approve: approve)
        }
    }

    func answer(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let q = pendingQuestion, !trimmed.isEmpty else { return }
        pendingQuestion = nil
        Telemetry.signal(.questionAnswered, ["latency": Telemetry.latency(since: q.shownAt)])
        command("answer") { [sessionId] in try await Api.shared.answer(sessionId, requestId: q.requestId, text: trimmed) }
    }

    func cancel() {
        command("cancel") { [sessionId] in try await Api.shared.cancelSession(sessionId) }
    }

    /// Signal the steering command (v1 `phoneCommand`, unchanged), mark the
    /// funnel's last step, and post it; a failed post is counted, still silent.
    private func command(_ name: String, _ post: @escaping () async throws -> Void) {
        Telemetry.signal(.phoneCommand, ["command": name])
        Telemetry.onboarding(.firstPhoneCommand)
        Task {
            do { try await post() }
            catch { Telemetry.error(.relay, name, error) }
        }
    }

    /// The approval's tool kind, folded to a fixed set (MCP / custom tool names never leave).
    private static func toolBucket(_ kind: String) -> String {
        let k = kind.lowercased()
        if k.contains("write") || k.contains("edit") || k.contains("patch") { return "write" }
        if k.contains("bash") || k.contains("shell") || k.contains("exec") || k.contains("command") { return "shell" }
        if k.contains("fetch") || k.contains("web") || k.contains("http") { return "fetch" }
        return "other"
    }

    #if DEBUG
    /// Seed a realistic transcript + pending approval for UI screenshots (no stream).
    func seedDemo() {
        state = .awaiting
        runnerConnected = true
        items = [
            .init(id: 1, role: .user, text: "Refactor the auth middleware to pull the bearer token and 401 on a missing one."),
            .init(id: 2, role: .assistant, text: "On it. I'll parse the Authorization header, strip the \"Bearer \" prefix, and return 401 when it's missing — before verifying the Supabase JWT."),
            .init(id: 3, role: .tool, text: "→ read_file(src/auth/middleware.ts)  ✓"),
            .init(id: 4, role: .tool, text: "→ edit(src/auth/middleware.ts)"),
            .init(id: 5, role: .note, text: "Needs approval — Write src/auth/middleware.ts"),
        ]
        diffs = DemoData.diffs
        pendingApproval = PendingApproval(
            requestId: "r1",
            kind: "write_file",
            label: "Write src/auth/middleware.ts",
            preview: "+  const token = req.headers.authorization?.replace(\"Bearer \", \"\")\n+  if (!token) return res.status(401).json({ error: \"missing token\" })"
        )
    }
    #endif
}

struct SessionView: View {
    let sessionId: String

    @Environment(AppModel.self) private var model
    @State private var transcript = SessionTranscript()
    @State private var composer = ""
    @State private var answerText = ""
    @State private var showChanges = false
    @State private var toast: String?

    private var title: String {
        model.sessions.first { $0.id == sessionId }?.title ?? "Session"
    }

    /// Live git review runs on the editor's working copy — editor runs only.
    private var canReviewLive: Bool {
        model.sessions.first { $0.id == sessionId }?.runner == "editor"
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if transcript.truncated {
                            Text("Earlier history isn't available.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                        }
                        ForEach(transcript.items) { item in
                            row(item).id(item.id)
                        }
                        if transcript.state == .running {
                            HStack(spacing: 8) {
                                TypingDots()
                                Text(transcript.liveLine.isEmpty ? "Working…" : transcript.liveLine)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .padding(.top, 2)
                            .id(-1)
                        }
                    }
                    .padding(16)
                    .animation(Theme.spring, value: transcript.items.count)
                }
                .onChange(of: transcript.items.count) {
                    withAnimation { proxy.scrollTo(transcript.items.last?.id ?? -1, anchor: .bottom) }
                }
            }

        }
        .background(CeliadorBackground())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                if let approval = transcript.pendingApproval {
                    approvalCard(approval)
                }
                if let question = transcript.pendingQuestion {
                    questionCard(question)
                }
                composerBar
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .toast($toast)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if !transcript.diffs.isEmpty || canReviewLive {
                    Button { showChanges = true } label: {
                        if transcript.diffs.isEmpty {
                            Image(systemName: "arrow.triangle.branch")
                        } else {
                            Label("\(transcript.diffs.count)", systemImage: "arrow.triangle.branch")
                        }
                    }
                    .accessibilityLabel("Review changes")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if transcript.state == .running {
                    Button(role: .destructive) { Haptics.warning(); transcript.cancel(); toast = "Stopping…" } label: {
                        Label("Stop", systemImage: "stop.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $showChanges) {
            ChangesView(title: title, diffs: transcript.diffs, liveSessionId: canReviewLive ? sessionId : nil)
                .trackScreen(.changes)
        }
        .trackScreen(.session)
        .onAppear {
            #if DEBUG
            if DemoData.isActive { transcript.seedDemo(); return }
            #endif
            trackOpened()
            transcript.start(sessionId: sessionId, model: model)
        }
        .onDisappear { transcript.stop() }
    }

    /// `sessionOpened`: the run's state and whether its editor was there to steer.
    private func trackOpened() {
        let session = model.sessions.first { $0.id == sessionId }
        let editor: String
        switch session {
        case nil: editor = "unknown"
        case let s? where s.runner == "editor": editor = s.runnerConnected ? "online" : "offline"
        case _?: editor = "cloud"
        }
        Telemetry.signal(.sessionOpened, ["state": session?.state.rawValue ?? "unknown", "editor": editor])
        Telemetry.onboarding(.firstSessionOpened)
    }

    // MARK: - Transcript rows

    @ViewBuilder
    private func row(_ item: TranscriptItem) -> some View {
        switch item.role {
        case .user:
            Text(item.text)
                .font(.body)
                .foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 48)
                .transition(.move(edge: .trailing).combined(with: .opacity))
        case .assistant:
            Text(item.text)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.trailing, 24)
        case .tool:
            HStack(spacing: 6) {
                Image(systemName: item.text.hasSuffix("✓") ? "checkmark.circle.fill" : item.text.hasSuffix("✗") ? "xmark.circle.fill" : "circle.dotted")
                    .font(.caption)
                    .foregroundStyle(item.text.hasSuffix("✗") ? Theme.red : .secondary)
                Text(item.text.replacingOccurrences(of: "→ ", with: "").replacingOccurrences(of: "  ✓", with: "").replacingOccurrences(of: "  ✗", with: ""))
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.middle)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.panel, in: Capsule())
            .frame(maxWidth: .infinity, alignment: .leading)
        case .note:
            Label(item.text, systemImage: "hand.raised.fill")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.attention)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .diff:
            Text(item.text)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .elevatedCard(cornerRadius: Theme.Radius.sm, padding: 12)
        case .error:
            Label(item.text, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(Theme.red)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.red.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
        }
    }

    // MARK: - Steering surfaces

    private func approvalCard(_ approval: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                IconBadge(systemName: "hand.raised.fill", color: Theme.attention)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Needs your approval").font(.subheadline.weight(.semibold))
                    Text(approval.label).font(.footnote.monospaced()).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            if let preview = approval.preview, !preview.isEmpty {
                Text(preview)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
            }
            HStack(spacing: 10) {
                Button {
                    Haptics.success(); transcript.resolve(true); toast = "Approved"
                } label: {
                    Label("Allow", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .primaryButton()
                Button(role: .destructive) {
                    Haptics.warning(); transcript.resolve(false); toast = "Denied"
                } label: {
                    Label("Deny", systemImage: "xmark").frame(maxWidth: .infinity)
                }
                .secondaryButton()
                .tint(Theme.red)
            }
        }
        .padding(16)
        .glassPanel()
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func questionCard(_ question: PendingQuestion) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                IconBadge(systemName: "questionmark", color: Theme.attention)
                VStack(alignment: .leading, spacing: 2) {
                    Text("The agent is asking").font(.subheadline.weight(.semibold))
                    Text(question.prompt).font(.footnote).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Answer…", text: $answerText, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                SendButton(enabled: !answerText.trimmingCharacters(in: .whitespaces).isEmpty) {
                    Haptics.tap(); transcript.answer(answerText); answerText = ""
                }
            }
        }
        .padding(16)
        .glassPanel()
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var composerBar: some View {
        let offline = !transcript.runnerConnected
        return HStack(alignment: .bottom, spacing: 8) {
            if offline { Image(systemName: "bolt.slash.fill").font(.caption).foregroundStyle(.secondary) }
            TextField(offline ? "Editor offline…" : "Send a follow-up…", text: $composer, axis: .vertical)
                .lineLimit(1...4)
                .disabled(offline)
            SendButton(enabled: !offline && !composer.trimmingCharacters(in: .whitespaces).isEmpty) {
                Haptics.tap(); transcript.send(composer); composer = ""
            }
        }
        .padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 6)
        .glassCapsule()
    }
}

/// Circular gradient send button used by the composer and question card.
struct SendButton: View {
    var enabled: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.up")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(enabled ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Color.gray.opacity(0.5)), in: Circle())
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .animation(Theme.snappy, value: enabled)
    }
}

/// Three dots that ripple while the agent is working.
private struct TypingDots: View {
    @State private var t = false
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { i in
                Circle().fill(Theme.accent)
                    .frame(width: 5, height: 5)
                    .opacity(t ? 1 : 0.3)
                    .animation(.easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2), value: t)
            }
        }
        .onAppear { t = true }
    }
}
