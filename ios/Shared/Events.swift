import Foundation

/// Live event stream for one session: the phone's window into an agent run
/// happening in the editor. Connects to `GET /api/sessions/:id/events` (SSE) and
/// reconnects with backoff, resuming from the last seq it saw (`?cursor=`) so no
/// events are missed across a drop.
///
/// Delivers decoded `SessionEvent`s on the main actor via `onEvent`. High-frequency
/// (streamed deltas) but cheap — the caller folds them into a transcript.
final class SessionEventStream {
    private let sessionId: String
    private let onEvent: @MainActor (SessionEvent) -> Void
    private var task: Task<Void, Never>?
    private var cursor: Int

    init(sessionId: String, since cursor: Int = 0, onEvent: @escaping @MainActor (SessionEvent) -> Void) {
        self.sessionId = sessionId
        self.cursor = cursor
        self.onEvent = onEvent
    }

    func start() {
        guard task == nil else { return }
        task = Task {
            var delay = 1.0
            while !Task.isCancelled {
                let connectedAt = Date()
                try? await stream()
                if Task.isCancelled { return }
                if Date().timeIntervalSince(connectedAt) > 60 { delay = 1.0 }
                try? await Task.sleep(for: .seconds(delay))
                delay = min(delay * 2, 30)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    private func stream() async throws {
        let token = try await Api.shared.validAccessToken()
        var components = URLComponents(
            url: Api.shared.baseURL.appendingPathComponent("api/sessions/\(sessionId)/events"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "cursor", value: String(cursor))]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 3600 // idle timer; the daemon heartbeats every 15s

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Api.ApiError(message: "Event stream rejected.")
        }
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            guard line.hasPrefix("data:") else { continue } // skip id:/ping: frames
            let json = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            guard !json.isEmpty,
                  let data = json.data(using: .utf8),
                  let event = try? JSONDecoder().decode(SessionEvent.self, from: data)
            else { continue }
            if event.seq > cursor { cursor = event.seq } // resume point for reconnects
            await MainActor.run { self.onEvent(event) }
        }
    }
}

/// Live task changes for the queue: `GET /api/tasks/stream` (SSE) sends the full
/// task as an `event: task` frame whenever one changes. Reconnects with backoff;
/// there is no cursor, so callers should re-list on (re)connect if they care
/// about a gap — the queue also polls, so a dropped frame heals on its own.
final class TaskEventStream {
    private let onTask: @MainActor (AgentTask) -> Void
    private var task: Task<Void, Never>?

    init(onTask: @escaping @MainActor (AgentTask) -> Void) {
        self.onTask = onTask
    }

    func start() {
        guard task == nil else { return }
        task = Task {
            var delay = 2.0
            while !Task.isCancelled {
                let connectedAt = Date()
                try? await stream()
                if Task.isCancelled { return }
                if Date().timeIntervalSince(connectedAt) > 60 { delay = 2.0 }
                try? await Task.sleep(for: .seconds(delay))
                delay = min(delay * 2, 60)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    private func stream() async throws {
        let token = try await Api.shared.validAccessToken()
        var request = URLRequest(url: Api.shared.baseURL.appendingPathComponent("api/tasks/stream"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 3600

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Api.ApiError(message: "Task stream rejected.")
        }
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
            await MainActor.run { self.onTask(task) }
        }
    }
}
