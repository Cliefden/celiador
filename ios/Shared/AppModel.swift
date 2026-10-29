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

    /// The IDE shell's bottom tabs: Queue · Runs (agents) · Files (explorer) · Activity.
    enum Tab: Hashable { case queue, agents, explorer, activity }

    /// A screen pushed on the Queue tab's stack.
    enum QueueRoute: Hashable {
        /// The One-run screen for an agent task.
        case task(String)
        /// A session's full live transcript.
        case session(String)
    }

    var phase: Phase = .booting
    var email: String?
    var sessions: [Session] = []
    var selectedTab: Tab = .queue
    var agentsPath: [String] = [] // Runs-tab navigation: session ids
    var queuePath: [QueueRoute] = [] // Queue-tab navigation: run screens + transcripts
    /// The session whose workspace the Explorer tab is browsing (defaults to newest active).
    var focusedSessionId: String?

    // MARK: Agent tasks (the queue) — shared so deep links and pushes can resolve a task.
    var tasks: [AgentTask] = []
    /// Tasks allowed to run at once (0 = unknown).
    var taskConcurrency = 0
    /// Repos whose labelled GitHub issues become tasks.
    var watchedRepos: [String] = []
    var tasksLoaded = false
    var tasksError: String?
    /// Approvals / answers sent from the phone, hidden optimistically until the
    /// daemon clears the task's `awaiting`.
    var handledRequests: Set<String> = []
    private var taskStream: TaskEventStream?

    /// The task a session belongs to, if any (pushes + widgets prefer its run screen).
    func task(forSession sessionId: String) -> AgentTask? {
        tasks.first { $0.sessionId == sessionId }
    }

    // MARK: Queue buckets (contract: Needs you / Ready to merge / Running / finished)

    /// Blocked on you: the daemon's `awaiting`, or — from an older daemon that
    /// doesn't send it — the linked session's own `awaiting` state.
    func needsYou(_ task: AgentTask) -> Bool {
        guard !task.isFinished else { return false }
        if let awaiting = task.awaiting { return !handledRequests.contains(awaiting.requestId) }
        guard let sid = task.sessionId else { return false }
        return sessions.first { $0.id == sid }?.state == .awaiting
    }

    var needsYouTasks: [AgentTask] { tasks.filter(needsYou) }
    var readyTasks: [AgentTask] { tasks.filter { $0.state == "pr-open" && !needsYou($0) } }
    var runningTasks: [AgentTask] { tasks.filter { $0.isActive && !needsYou($0) } }
    var finishedTasks: [AgentTask] { tasks.filter(\.isFinished) }

    /// Awaiting sessions that aren't any task's run (plain editor/phone chats).
    var looseAwaitingSessions: [Session] {
        let linked = Set(tasks.compactMap(\.sessionId))
        return sessions.filter { $0.state == .awaiting && !linked.contains($0.id) }
    }

    /// The Queue tab badge: everything in "Needs you".
    var queueNeedsYouCount: Int { needsYouTasks.count + looseAwaitingSessions.count }

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
        tasks = DemoData.tasks
        taskConcurrency = 3
        watchedRepos = ["https://github.com/Cliefden/celiador-editor.git", "https://github.com/Cliefden/daemon.git"]
        tasksLoaded = true
        // CELIADOR_UI_DEMO=run opens the One-run screen for the ready task.
        if DemoData.mode == "run" { queuePath = [.task(DemoData.readyTaskId)] }
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
        taskStream?.stop()
        taskStream = nil
        sessions = []
        activity = [:]
        agentsPath = []
        queuePath = []
        tasks = []
        tasksLoaded = false
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
                await self?.refreshTasks()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        // Task changes (state, awaiting, PR stats) arrive live between polls.
        taskStream?.stop()
        let stream = TaskEventStream { [weak self] task in self?.upsert(task) }
        taskStream = stream
        stream.start()
    }

    /// Re-list the queue (GET /api/tasks).
    func refreshTasks() async {
        guard case .signedIn = phase else { return }
        #if DEBUG
        if DemoData.isActive { tasksLoaded = true; return }
        #endif
        do {
            let list = try await Api.shared.listTasks()
            tasks = list.tasks
            taskConcurrency = list.concurrency
            watchedRepos = list.repos
            tasksError = nil
        } catch {
            tasksError = (error as NSError).localizedDescription
        }
        tasksLoaded = true
    }

    /// Fold one streamed task into the list (newest first for new ones).
    func upsert(_ task: AgentTask) {
        if let i = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[i] = task
        } else {
            tasks.insert(task, at: 0)
        }
    }

    /// Navigate to a session (from a push tap or a widget deep link). A session
    /// that belongs to an agent task opens that task's run screen on the Queue
    /// tab instead of the bare transcript.
    func open(sessionId: String) {
        guard case .signedIn = phase else { return }
        if let task = task(forSession: sessionId) {
            open(taskId: task.id)
            return
        }
        if !tasksLoaded {
            // Cold launch from a push: the queue isn't loaded yet — load, then route.
            Task {
                await refreshTasks()
                if let task = task(forSession: sessionId) { open(taskId: task.id) } else { openTranscript(sessionId) }
            }
            return
        }
        openTranscript(sessionId)
    }

    private func openTranscript(_ sessionId: String) {
        selectedTab = .agents
        agentsPath = [sessionId]
    }

    /// `celiador://task/<id>`: the Queue tab with that task's run screen pushed.
    func open(taskId: String) {
        guard case .signedIn = phase else { return }
        selectedTab = .queue
        queuePath = [.task(taskId)]
    }

    /// `celiador://queue`: the Queue tab at its root.
    func openQueue() {
        guard case .signedIn = phase else { return }
        selectedTab = .queue
        queuePath = []
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
