import SwiftUI

/// Celiador's wearable companion: a thin watchOS app to glance at agent runs and
/// approve/deny from the wrist. Reuses the shared Api / Models / Events / Theme; it
/// relies on the signed-in session in the shared keychain (handed from the phone).
@main
struct CeliadorWatchApp: App {
    @State private var model = WatchModel()
    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(model)
                .tint(Theme.celadonBright)
                .task { await model.boot() }
        }
    }
}

@MainActor
@Observable
final class WatchModel {
    var sessions: [Session] = []
    var loaded = false
    var signedIn = true

    func boot() async {
        // Receive the session handed over from the paired iPhone, then re-check.
        WatchSync.shared.onSessionImported = { [weak self] in Task { await self?.refresh() } }
        WatchSync.shared.start()
        _ = await Api.shared.restoreSession()
        await refresh()
    }

    func refresh() async {
        do {
            sessions = try await Api.shared.listSessions()
            signedIn = true
        } catch {
            signedIn = false
        }
        loaded = true
    }
}

struct WatchRootView: View {
    @Environment(WatchModel.self) private var model

    private var active: [Session] {
        model.sessions.filter { $0.state.isActive || $0.state == .awaiting || $0.state == .error }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !model.loaded {
                    ProgressView()
                } else if !model.signedIn {
                    ContentUnavailableView("Sign in on your iPhone", systemImage: "iphone")
                } else if active.isEmpty {
                    ContentUnavailableView("No active runs", systemImage: "checkmark.circle")
                } else {
                    List(active) { session in
                        NavigationLink(value: session.id) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.title).font(.caption).lineLimit(2)
                                Text(session.state.label).font(.caption2).foregroundStyle(stateColor(session.state))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Celiador")
            .navigationDestination(for: String.self) { WatchSessionView(sessionId: $0) }
        }
        .refreshable { await model.refresh() }
    }

    private func stateColor(_ s: SessionState) -> Color {
        switch s {
        case .running: return Theme.celadonBright
        case .awaiting, .error: return Theme.attention
        default: return Theme.dim
        }
    }
}

/// Live view of one run: current activity + any pending approval to allow/deny.
struct WatchSessionView: View {
    let sessionId: String
    @State private var stream: SessionEventStream?
    @State private var state: SessionState = .idle
    @State private var liveLine = ""
    @State private var pending: (requestId: String, label: String)?
    @State private var resolving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(state.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                if !liveLine.isEmpty {
                    Text(liveLine).font(.caption2).foregroundStyle(Theme.dim)
                }
                if let pending {
                    Divider()
                    Text(pending.label).font(.caption2).foregroundStyle(Theme.ink)
                    HStack(spacing: 8) {
                        Button { resolve(true) } label: { Label("Allow", systemImage: "checkmark") }
                            .tint(Theme.celadon)
                        Button(role: .destructive) { resolve(false) } label: { Label("Deny", systemImage: "xmark") }
                    }
                    .disabled(resolving)
                    .buttonStyle(.bordered)
                    .font(.caption2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        .navigationTitle("Run")
        .onAppear { start() }
        .onDisappear { stream?.stop(); stream = nil }
    }

    private func start() {
        let s = SessionEventStream(sessionId: sessionId, since: 0) { event in
            switch event.kind {
            case "state": if let st = event.state { state = st; if !st.isActive { liveLine = "" } }
            case "activity": liveLine = event.text ?? ""
            case "approval":
                if let rid = event.requestId {
                    let kind = event.approvalKind ?? "tool"
                    pending = (rid, event.title ?? event.path.map { "Write \($0)" } ?? "Run \(kind)")
                }
            case "done": state = .done; pending = nil; liveLine = ""
            case "error": state = .error; liveLine = event.message ?? ""
            default: break
            }
        }
        stream = s
        s.start()
    }

    private func resolve(_ approve: Bool) {
        guard let p = pending else { return }
        resolving = true
        pending = nil
        Task {
            try? await Api.shared.resolveApproval(sessionId, requestId: p.requestId, approve: approve)
            resolving = false
        }
    }
}
