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

    /// The IDE shell's bottom tabs.
    enum Tab: Hashable { case queue, agents, explorer, activity }

    var phase: Phase = .booting
    var email: String?
    var sessions: [Session] = []
    var selectedTab: Tab = .queue
    var agentsPath: [String] = [] // Agents-tab navigation: session ids
    var queuePath: [String] = [] // Queue-tab navigation: session ids
    /// The session whose workspace the Explorer tab is browsing (defaults to newest active).
    var focusedSessionId: String?

    /// Latest live agent line per session, fed by the open session's event stream.
    /// Shown as an active session's subtitle; pruned when the session goes inactive.
    var activity: [String: String] = [:]

    /// Sessions blocked on a decision from you — the badge count. Failed runs are
    /// history, not actionable, so they don't badge.
    var needsYouCount: Int {
        sessions.filter { $0.state == .awaiting }.count
    }

    private var pollTask: Task<Void, Never>?

    func boot() async {
        #if DEBUG
        // UI showcase hook: seed a signed-in state offline. "empty" → no sessions;
        // any other non-empty value → mock sessions (the specific screen is routed by ContentView).
        if let demo = ProcessInfo.processInfo.environment["CELIADOR_UI_DEMO"], !demo.isEmpty {
            if demo == "empty" { email = "demo@celiador.ai"; phase = .signedIn }
            else { seedDemo() }
            return
        }
        #endif
        #if os(iOS)
        WatchSync.shared.start() // hand the session to a paired watch
        #endif
        do {
            _ = try await Api.shared.loadConfig()
        } catch {
            #if os(iOS)
            Telemetry.error(.config, "load", error)
            #endif
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

    #if DEBUG
    /// Populate a realistic session list for UI screenshots (no backend).
    private func seedDemo() {
        func iso(_ ago: TimeInterval) -> String {
            ISO8601DateFormatter().string(from: Date().addingTimeInterval(-ago))
        }
        sessions = [
            Session(id: "s1", title: "Refactor auth middleware", origin: "editor", runner: "editor", state: .awaiting, runnerConnected: true, lastSeq: 42, createdAt: iso(1800), updatedAt: iso(70)),
            Session(id: "s2", title: "Fix flaky checkout test", origin: "editor", runner: "editor", state: .error, runnerConnected: false, lastSeq: 18, createdAt: iso(5400), updatedAt: iso(300)),
            Session(id: "s3", title: "Add dark-mode toggle to settings", origin: "phone", runner: "server", state: .running, runnerConnected: true, lastSeq: 7, createdAt: iso(300), updatedAt: iso(9)),
            Session(id: "s4", title: "Migrate API client to async/await", origin: "editor", runner: "editor", state: .running, runnerConnected: true, lastSeq: 55, createdAt: iso(720), updatedAt: iso(26)),
            Session(id: "s5", title: "Update README and changelog", origin: "editor", runner: "editor", state: .done, runnerConnected: false, lastSeq: 90, createdAt: iso(90000), updatedAt: iso(7200)),
            Session(id: "s6", title: "Investigate memory leak in widget", origin: "phone", runner: "server", state: .done, runnerConnected: false, lastSeq: 33, createdAt: iso(200000), updatedAt: iso(93000)),
        ]
        activity = [
            "s3": "Editing SettingsView.swift — wiring the toggle binding",
            "s4": "Running tests — 24 passed, 2 remaining",
        ]
        focusedSessionId = "s1"
        email = "demo@celiador.ai"
        phase = .signedIn
    }
    #endif

    func didSignIn() {
        email = Api.shared.session?.email
        #if os(iOS)
        WatchSync.shared.pushSession() // sync the new session to a paired watch
        #endif
        phase = .signedIn
        #if os(iOS)
        Telemetry.onboarding(.signedIn)
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
        agentsPath = []
        focusedSessionId = nil
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
        selectedTab = .agents
        agentsPath = [sessionId]
    }

    /// Fold a live line from the open session's stream into the list + widget.
    func noteActivity(sessionId: String, text: String) {
        activity[sessionId] = text
        #if os(iOS)
        LiveActivityManager.shared.updateLine(sessionId: sessionId, text: text, sessions: sessions)
        #endif
    }

    /// Report a failing session-list poll once per failure streak, not every 15s.
    private var listFailing = false

    func refresh() async {
        guard case .signedIn = phase else { return }
        let latest: [Session]
        do {
            latest = try await Api.shared.listSessions()
            listFailing = false
        } catch {
            #if os(iOS)
            if !listFailing { Telemetry.error(.sessions, "list", error) }
            #endif
            listFailing = true
            return
        }
        sessions = latest
        #if os(iOS)
        // Any editor-run session proves the desktop is paired to this account;
        // one the editor started itself is a session mirrored to the phone.
        if latest.contains(where: { $0.runner == "editor" }) { Telemetry.onboarding(.editorPaired) }
        if latest.contains(where: { $0.origin == "editor" }) { Telemetry.onboarding(.firstSessionMirrored) }
        #endif
        let active = Set(latest.filter { $0.state.isActive }.map(\.id))
        activity = activity.filter { active.contains($0.key) }
        // Keep the Explorer's focused session valid; default to the newest active run.
        if focusedSessionId == nil || !latest.contains(where: { $0.id == focusedSessionId }) {
            focusedSessionId = latest.first(where: { $0.state.isActive })?.id ?? latest.first?.id
        }
        publishSnapshot()
        #if os(iOS)
        LiveActivityManager.shared.reconcile(sessions: sessions, activity: activity)
        #endif
        #if DEBUG
        if ProcessInfo.processInfo.environment["CELIADOR_AUTOOPEN"] != nil,
           agentsPath.isEmpty, let first = latest.first {
            agentsPath = [first.id]
        }
        #endif
    }

    /// Publish a compact snapshot for the Home Screen widget (App Group) and nudge
    /// WidgetKit. Ordered attention-first (awaiting), then running.
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

        let attention = sessions.filter { $0.state == .awaiting }
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
