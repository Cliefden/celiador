import Foundation

/// Whether the app is in the foreground. Set by the app from SwiftUI's
/// `scenePhase` (`AppModel.setActive`); the event streams below pause while it's
/// false and reconnect at once when it flips back — no stream or poll keeps
/// running in the background, and nothing waits out a backoff on return.
@MainActor
enum AppLifecycle {
    private(set) static var isActive = true
    static let didChange = Notification.Name("CeliadorAppLifecycleDidChange")

    static func set(active: Bool) {
        guard active != isActive else { return }
        isActive = active
        NotificationCenter.default.post(name: didChange, object: nil)
    }
}

/// Reconnect policy shared by the streams: exponential backoff with jitter, and
/// which failures are worth retrying at all.
enum StreamRetry {
    /// A random delay in [base/2, base] ("equal jitter"), so many clients that
    /// lost the daemon at once don't reconnect in lockstep.
    static func jittered(_ base: Double) -> Double {
        base / 2 + Double.random(in: 0...(base / 2))
    }

    /// Statuses after which reconnecting can't help: the resource is gone (a
    /// deleted session, or an older daemon without the endpoint).
    static func isTerminal(_ status: Int?) -> Bool {
        status == 404 || status == 410
    }

    /// Thrown when no access token can be had at all: signed out, or GoTrue
    /// rejected the refresh token (Api has signed out). Retrying can't help.
    struct SignedOut: Error {}

    /// A token for the next connection; `rejected` (the token the last attempt
    /// got a 401 for) forces a refresh even though its local `expiresAt` says
    /// it's still good — otherwise a server-rejected token loops forever.
    static func token(rejected: String?) async throws -> String {
        do {
            return try await Api.shared.validAccessToken(rejected: rejected)
        } catch let error as Api.ApiError where Api.isRevocation(error) {
            throw SignedOut()
        }
    }

    /// Whether the reconnect loop should give up after `error`.
    static func shouldStop(after error: Error) -> Bool {
        error is SignedOut || isTerminal((error as? Api.ApiError)?.status)
    }

    /// Open an SSE request with a fresh token. `rejected` is in/out: read to
    /// force a refresh, set to the sent token on a 401, cleared on success.
    static func open(_ request: URLRequest, rejected: inout String?, what: String) async throws -> URLSession.AsyncBytes {
        let token = try await Self.token(rejected: rejected)
        var request = request
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 3600 // idle timer; the daemon heartbeats every 15s
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode
        guard status == 200 else {
            rejected = status == 401 ? token : nil
            throw Api.ApiError(message: "\(what) rejected.", status: status)
        }
        rejected = nil
        return bytes
    }
}

/// A reconnecting SSE connection that pauses in the background: the shared
/// lifecycle of `SessionEventStream` and `TaskEventStream`. Main-actor
/// isolated; `body` (the network reads and decoding) is `@Sendable`, so it runs
/// off the main actor and hops back only to deliver.
@MainActor
private final class ReconnectingStream {
    /// One connection, until it ends or throws. Gets `rejected` (see
    /// `StreamRetry.open`) and must hand it back updated.
    typealias Body = @Sendable (_ rejected: inout String?) async throws -> Void

    private let body: Body
    private let maxDelay: Double
    private let initialDelay: Double
    private let onFailure: (@MainActor (Error) -> Void)?
    private var task: Task<Void, Never>?
    /// `start()` was called and `stop()` wasn't.
    private var wanted = false
    private var lifecycle: NSObjectProtocol?

    init(initialDelay: Double, maxDelay: Double, onFailure: (@MainActor (Error) -> Void)?, body: @escaping Body) {
        self.initialDelay = initialDelay
        self.maxDelay = maxDelay
        self.onFailure = onFailure
        self.body = body
    }

    func start() {
        guard !wanted else { return }
        wanted = true
        lifecycle = NotificationCenter.default.addObserver(
            forName: AppLifecycle.didChange, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.lifecycleChanged() }
        }
        connect()
    }

    func stop() {
        wanted = false
        if let lifecycle { NotificationCenter.default.removeObserver(lifecycle) }
        lifecycle = nil
        task?.cancel()
        task = nil
    }

    private func lifecycleChanged() {
        if AppLifecycle.isActive {
            connect() // straight away: no backoff left over from before
        } else {
            task?.cancel()
            task = nil
        }
    }

    private func connect() {
        guard wanted, task == nil, AppLifecycle.isActive else { return }
        let body = self.body, initialDelay = self.initialDelay, maxDelay = self.maxDelay, onFailure = self.onFailure
        task = Task {
            var delay = initialDelay
            var rejected: String?
            var retriedAuth = false
            while !Task.isCancelled {
                let connectedAt = Date()
                do {
                    try await body(&rejected)
                } catch {
                    if Task.isCancelled { return }
                    onFailure?(error)
                    if StreamRetry.shouldStop(after: error) { return }
                }
                if Task.isCancelled { return }
                if Date().timeIntervalSince(connectedAt) > 60 { delay = initialDelay }
                // The first 401 in a row retries at once with a refreshed token;
                // a repeat (the daemon refuses even a fresh one) backs off.
                if rejected != nil, !retriedAuth {
                    retriedAuth = true
                    continue
                }
                if rejected == nil { retriedAuth = false }
                try? await Task.sleep(for: .seconds(StreamRetry.jittered(delay)))
                delay = min(delay * 2, maxDelay)
            }
        }
    }
}

/// Live event stream for one session: the phone's window into an agent run
/// happening in the editor. Connects to `GET /api/sessions/:id/events` (SSE) and
/// reconnects with backoff + jitter, resuming from the last seq it saw
/// (`?cursor=`) so no events are missed across a drop.
///
/// - A 401 forces a token refresh on the next attempt; a revoked refresh token
///   stops the stream (Api signs out).
/// - A 404 stops it: the session was deleted.
/// - It pauses while the app is in the background (`AppLifecycle`) and resumes
///   from its cursor when it comes back.
///
/// Delivers decoded `SessionEvent`s on the main actor via `onEvent`. High-frequency
/// (streamed deltas) but cheap — the caller folds them into a transcript.
@MainActor
final class SessionEventStream {
    private var connection: ReconnectingStream?
    private var cursor: Int
    private let onEvent: @MainActor (SessionEvent) -> Void

    init(
        sessionId: String,
        since cursor: Int = 0,
        onEvent: @escaping @MainActor (SessionEvent) -> Void,
        /// Told about each failed connection attempt (not about `stop()`), before the backoff.
        onFailure: (@MainActor (Error) -> Void)? = nil
    ) {
        self.cursor = cursor
        self.onEvent = onEvent
        let url = Api.shared.baseURL.appendingPathComponent("api/sessions/\(sessionId)/events")
        connection = ReconnectingStream(initialDelay: 1, maxDelay: 30, onFailure: onFailure) { [weak self] rejected in
            guard let since = await self?.cursor else { return }
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "cursor", value: String(since))]
            guard let streamURL = components?.url else { throw Api.ApiError(message: "Bad stream URL.", status: 404) }
            let bytes = try await StreamRetry.open(URLRequest(url: streamURL), rejected: &rejected, what: "Event stream")
            for try await line in bytes.lines {
                if Task.isCancelled { return }
                guard let event = SessionEventStream.decode(line) else { continue }
                await self?.deliver(event)
            }
        }
    }

    func start() { connection?.start() }
    func stop() { connection?.stop() }

    private func deliver(_ event: SessionEvent) {
        if event.seq > cursor { cursor = event.seq } // resume point for reconnects
        onEvent(event)
    }

    /// A `data:` frame's event; nil for `id:`/ping frames and anything undecodable.
    nonisolated static func decode(_ line: String) -> SessionEvent? {
        guard line.hasPrefix("data:") else { return nil }
        let json = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
        guard !json.isEmpty, let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(SessionEvent.self, from: data)
    }
}

/// Live task changes for the queue: `GET /api/tasks/stream` (SSE) sends the full
/// task as an `event: task` frame whenever one changes. Reconnects with backoff
/// and jitter; there is no cursor, so callers should re-list on (re)connect if
/// they care about a gap — the queue also polls (and re-lists on foreground), so
/// a dropped frame heals on its own. Same 401 / 404 / background handling as
/// `SessionEventStream`.
@MainActor
final class TaskEventStream {
    private var connection: ReconnectingStream?
    private let onTask: @MainActor (AgentTask) -> Void

    init(onTask: @escaping @MainActor (AgentTask) -> Void) {
        self.onTask = onTask
        let url = Api.shared.baseURL.appendingPathComponent("api/tasks/stream")
        connection = ReconnectingStream(initialDelay: 2, maxDelay: 60, onFailure: nil) { [weak self] rejected in
            let bytes = try await StreamRetry.open(URLRequest(url: url), rejected: &rejected, what: "Task stream")
            var event = ""
            for try await line in bytes.lines {
                if Task.isCancelled { return }
                if line.hasPrefix("event:") {
                    event = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
                    continue
                }
                guard line.hasPrefix("data:"), event == "task" || event.isEmpty else { continue }
                let json = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                guard !json.isEmpty,
                      let data = json.data(using: .utf8),
                      let task = try? JSONDecoder().decode(AgentTask.self, from: data)
                else { continue }
                await self?.deliver(task)
            }
        }
    }

    func start() { connection?.start() }
    func stop() { connection?.stop() }

    private func deliver(_ task: AgentTask) { onTask(task) }
}
