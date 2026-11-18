import Foundation
// `Activity` isn't Sendable; every one here is created, kept and ended on the
// main actor (this class), the async update/end calls only hop off it.
@preconcurrency import ActivityKit

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

    /// How long a pushed state counts as current. The app re-sends it every poll
    /// (15 s) while in the foreground, and the daemon's APNs updates carry their
    /// own stale date, so content older than this means nobody is updating it —
    /// the system then shows it as stale (`context.isStale`) instead of a frozen
    /// "working…".
    static let staleAfter: TimeInterval = 10 * 60
    /// How long a settled run's final state stays on the Lock Screen.
    static let settledDismissAfter: TimeInterval = 15 * 60

    /// End every Live Activity (sign-out / account deletion) — removed at once:
    /// nothing of the account should stay on the Lock Screen.
    func endAll() {
        adoptExisting()
        for (id, activity) in activities { end(id, activity: activity, reason: "signOut", final: nil) }
    }

    /// Bring Live Activities in line with the current session list: start ones
    /// that just began running, refresh the ones still live (running, or waiting
    /// on you — the amber "needs you" state), end ones that settled.
    func reconcile(sessions: [Session], activity: [String: String]) {
        adoptExisting()
        let live = sessions.filter { $0.state == .running || $0.state == .awaiting }
        let liveIds = Set(live.map(\.id))

        // Ending never depends on authorization: activities the user turned off
        // after they started must still be settled.
        for (id, current) in activities where !liveIds.contains(id) {
            // Why it ended: the session's new state, or gone from the list.
            if let session = sessions.first(where: { $0.id == id }) {
                end(id, activity: current, reason: session.state.rawValue, final: contentState(session, line: nil))
            } else {
                end(id, activity: current, reason: "removed", final: nil)
            }
        }

        let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        for session in live {
            let state = contentState(session, line: activity[session.id])
            if let existing = activities[session.id] {
                update(existing, sessionId: session.id, state: state)
            } else if enabled, session.state == .running {
                // Only a run seen working starts one; an old chat that has been
                // waiting for days shouldn't pop onto the Lock Screen.
                start(session, state: state)
            }
        }
    }

    /// Push a single fresh agent line into a live activity.
    func updateLine(sessionId: String, text: String, sessions: [Session]) {
        guard let activity = activities[sessionId],
              let session = sessions.first(where: { $0.id == sessionId }) else { return }
        update(activity, sessionId: sessionId, state: contentState(session, line: text))
    }

    private func update(_ activity: Activity<ChatActivityAttributes>, sessionId: String, state: ChatActivityAttributes.ContentState) {
        // Re-send unchanged content only to push the stale date forward. Compared
        // with what the activity shows now, which includes the daemon's pushes.
        if activity.content.state == state,
           let stale = activity.content.staleDate,
           stale.timeIntervalSinceNow > Self.staleAfter / 2 { return }
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))
        Task { await activity.update(content) }
    }

    private func contentState(_ session: Session, line: String?) -> ChatActivityAttributes.ContentState {
        ChatActivityAttributes.ContentState(statusLabel: session.state.label, activityText: line ?? "")
    }

    /// Where the activity's elapsed timer counts from: the session's creation for a
    /// fresh run, otherwise now (a long-lived chat picking up a new turn shouldn't
    /// read "3 days").
    private func startDate(_ session: Session) -> Date {
        guard let created = RelativeTime.date(session.createdAt),
              Date().timeIntervalSince(created) < 3600 else { return Date() }
        return created
    }

    private func start(_ session: Session, state: ChatActivityAttributes.ContentState) {
        let attributes = ChatActivityAttributes(
            sessionId: session.id,
            sessionTitle: session.title,
            startedAt: startDate(session),
            runner: session.runner
        )
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter)),
                pushType: .token
            )
            activities[session.id] = activity
            observeToken(activity, sessionId: session.id)
            Telemetry.signal(.liveActivityStarted)
        } catch {
            // Activities disabled or at the system limit — degrade silently.
            let code = (error as? ActivityAuthorizationError).map { String(describing: $0) } ?? "other"
            Telemetry.error(.liveActivity, "start", code: code)
        }
    }

    private func observeToken(_ activity: Activity<ChatActivityAttributes>, sessionId: String) {
        tokenTasks[sessionId]?.cancel()
        tokenTasks[sessionId] = Task {
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                do { try await Api.shared.registerActivityToken(sessionId: sessionId, token: token) }
                catch { Telemetry.error(.liveActivity, "registerToken", error) }
            }
        }
    }

    /// End an activity. With `final` (a run that settled: done / failed /
    /// cancelled) its last state stays on the Lock Screen for a while so you see
    /// how it ended; without (sign-out, deleted session) it goes at once.
    private func end(_ id: String, activity: Activity<ChatActivityAttributes>, reason: String, final: ChatActivityAttributes.ContentState?) {
        Telemetry.signal(.liveActivityEnded, ["reason": reason])
        activities[id] = nil
        tokenTasks[id]?.cancel()
        tokenTasks[id] = nil
        let content = final.map { ActivityContent(state: $0, staleDate: nil) }
        let policy: ActivityUIDismissalPolicy = final == nil
            ? .immediate
            : .after(Date().addingTimeInterval(Self.settledDismissAfter))
        Task { await activity.end(content, dismissalPolicy: policy) }
    }
}
