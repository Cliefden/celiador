import Foundation
import Observation
import WidgetKit

@MainActor
@Observable
final class AppModel {
    enum Phase {
        case booting
        case unreachable(String)
        case signedOut
        case signedIn
    }

    var phase: Phase = .booting
    var email: String?
    var sessions: [Session] = []
    var path: [String] = [] // navigation: session ids

    /// Latest live agent line per session, fed by the open session's event stream.
    /// Shown as an active session's subtitle; pruned when the session goes inactive.
    var activity: [String: String] = [:]

    /// Sessions blocked on you or failed — the badge count.
    var needsYouCount: Int {
        sessions.filter { $0.state == .awaiting || $0.state == .error }.count
    }

    private var pollTask: Task<Void, Never>?

    func boot() async {
        do {
            _ = try await Api.shared.loadConfig()
        } catch {
            phase = .unreachable("Can't reach celiador.ai — check your connection.")
            return
        }
        if let restored = await Api.shared.restoreSession() {
            email = restored
            didSignIn()
            return
        }
        #if DEBUG
        // Headless verification hook: pre-supplied credentials via environment.
        let env = ProcessInfo.processInfo.environment
        if let email = env["CELIADOR_EMAIL"], let password = env["CELIADOR_PASSWORD"] {
            if (try? await Api.shared.signIn(email: email, password: password)) != nil {
                self.email = email
                didSignIn()
                return
            }
        }
        #endif
        phase = .signedOut
    }

    func didSignIn() {
        email = Api.shared.session?.email
        phase = .signedIn
        #if os(iOS)
        PushManager.shared.requestAuthorization()
        PushManager.shared.attach(model: self)
        #endif
        startPolling()
    }

    /// Sign out locally. The push token is unregistered with the OUTGOING session's
    /// credentials (captured before they're cleared), and every on-device trace of
    /// the account — Live Activities and the widget snapshot — is removed.
    /// `serverAlreadyDeleted`: the account is gone server-side (tokens purged too).
    func signOut(serverAlreadyDeleted: Bool = false) {
        #if os(iOS)
        let pushToken = PushManager.shared.takeToken()
        if !serverAlreadyDeleted, let pushToken, let outgoing = Api.shared.session {
            Task { await Api.shared.unregisterPush(token: pushToken, signingOut: outgoing) }
        }
        LiveActivityManager.shared.endAll()
        #endif
        Api.shared.signOut()
        pollTask?.cancel()
        sessions = []
        activity = [:]
        path = []
        phase = .signedOut
        SharedStore.writeSnapshot(.empty)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// The slim daemon has no global event feed, so the session *list* is polled;
    /// the live transcript of an open session streams over its own SSE channel.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    /// Navigate to a session (from a push tap or a widget deep link).
    func open(sessionId: String) {
        guard case .signedIn = phase else { return }
        path = [sessionId]
    }

    /// Fold a live line from the open session's stream into the list + widget.
    func noteActivity(sessionId: String, text: String) {
        activity[sessionId] = text
        #if os(iOS)
        LiveActivityManager.shared.updateLine(sessionId: sessionId, text: text, sessions: sessions)
        #endif
    }

    func refresh() async {
        guard case .signedIn = phase else { return }
        if let latest = try? await Api.shared.listSessions() {
            sessions = latest
            let active = Set(latest.filter { $0.state.isActive }.map(\.id))
            activity = activity.filter { active.contains($0.key) }
            publishSnapshot()
            #if os(iOS)
            LiveActivityManager.shared.reconcile(sessions: sessions, activity: activity)
            #endif
            #if DEBUG
            if ProcessInfo.processInfo.environment["CELIADOR_AUTOOPEN"] != nil,
               path.isEmpty, let first = latest.first {
                path = [first.id]
            }
            #endif
        }
    }

    /// Publish a compact snapshot for the Home Screen widget (App Group) and nudge
    /// WidgetKit. Ordered attention-first (awaiting/error), then running.
    private func publishSnapshot() {
        func bucket(_ state: SessionState) -> String {
            switch state {
            case .error: return "error"
            case .awaiting: return "needs-you"
            case .running: return "working"
            default: return "ready"
            }
        }
        func detail(_ s: Session) -> String {
            if s.state.isActive, let line = activity[s.id], !line.isEmpty { return line }
            return s.state.label
        }

        let attention = sessions.filter { $0.state == .awaiting || $0.state == .error }
        let running = sessions.filter { $0.state == .running }
        let ordered = (attention + running).sorted { $0.updatedAt > $1.updatedAt }
        let items = ordered.prefix(5).map {
            ChatSnapshotItem(id: $0.id, name: $0.title, bucket: bucket($0.state), detail: detail($0))
        }
        SharedStore.writeSnapshot(ChatSnapshot(
            needsYou: needsYouCount,
            working: running.count,
            items: Array(items),
            updatedAt: Date()
        ))
        WidgetCenter.shared.reloadAllTimelines()
    }
}
