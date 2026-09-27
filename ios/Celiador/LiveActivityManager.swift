import Foundation
import ActivityKit

/// Starts a Live Activity when a session begins running, updates it as the agent
/// streams progress, and ends it when the session settles. Each activity's push
/// token is handed to the daemon so updates keep flowing while the app is
/// suspended (the daemon drives them via APNs `liveactivity` push).
@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()

    private var activities: [String: Activity<ChatActivityAttributes>] = [:]
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var adopted = false

    /// Re-adopt activities that survived a relaunch (the system keeps them alive,
    /// but our in-memory map starts empty) so they're updated/ended instead of
    /// duplicated or orphaned. Duplicates for the same session are ended.
    private func adoptExisting() {
        guard !adopted else { return }
        adopted = true
        for activity in Activity<ChatActivityAttributes>.activities {
            let id = activity.attributes.sessionId
            if activities[id] == nil {
                activities[id] = activity
                observeToken(activity, sessionId: id)
            } else {
                Task { await activity.end(nil, dismissalPolicy: .immediate) }
            }
        }
    }

    /// End every Live Activity (sign-out / account deletion).
    func endAll() {
        adoptExisting()
        for (id, activity) in activities { end(id, activity: activity) }
    }

    /// Bring Live Activities in line with the current session list: start ones
    /// that just began running, refresh them, end ones that settled.
    func reconcile(sessions: [Session], activity: [String: String]) {
        adoptExisting()
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let running = sessions.filter { $0.state == .running }
        let runningIds = Set(running.map(\.id))

        for session in running {
            let state = contentState(session, line: activity[session.id])
            if let existing = activities[session.id] {
                Task { await existing.update(ActivityContent(state: state, staleDate: nil)) }
            } else {
                start(session, state: state)
            }
        }

        for (id, activity) in activities where !runningIds.contains(id) {
            end(id, activity: activity)
        }
    }

    /// Push a single fresh agent line into a running activity.
    func updateLine(sessionId: String, text: String, sessions: [Session]) {
        guard let activity = activities[sessionId],
              let session = sessions.first(where: { $0.id == sessionId }) else { return }
        let state = contentState(session, line: text)
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    private func contentState(_ session: Session, line: String?) -> ChatActivityAttributes.ContentState {
        ChatActivityAttributes.ContentState(statusLabel: session.state.label, activityText: line ?? "")
    }

    private func start(_ session: Session, state: ChatActivityAttributes.ContentState) {
        let attributes = ChatActivityAttributes(sessionId: session.id, sessionTitle: session.title)
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: nil),
                pushType: .token
            )
            activities[session.id] = activity
            observeToken(activity, sessionId: session.id)
        } catch {
            // Activities disabled or at the system limit — degrade silently.
        }
    }

    private func observeToken(_ activity: Activity<ChatActivityAttributes>, sessionId: String) {
        tokenTasks[sessionId]?.cancel()
        tokenTasks[sessionId] = Task {
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                try? await Api.shared.registerActivityToken(sessionId: sessionId, token: token)
            }
        }
    }

    private func end(_ id: String, activity: Activity<ChatActivityAttributes>) {
        activities[id] = nil
        tokenTasks[id]?.cancel()
        tokenTasks[id] = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
