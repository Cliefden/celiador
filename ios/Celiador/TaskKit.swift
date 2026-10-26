import SwiftUI

// Shared pieces of the Queue and One-run screens: how a task reads (meta line,
// runner, state), the card surface, and the actions both screens trigger
// (approve / deny / answer, merge, follow-up) with fallbacks for an older daemon.

// MARK: - Display

extension AgentTask {
    /// "#52 · celiador-editor" (or just the repo for a hand-started task).
    var metaPrefix: String {
        issue.map { "#\($0.number) · \(repo.name)" } ?? repo.name
    }

    /// "Mac" / "Cloud" — where the run happens (an editor dispatch when unknown).
    var runnerLabel: String { isCloud ? "Cloud" : "Mac" }

    /// "your Mac" / "the cloud" for sentences.
    var runnerPhrase: String { isCloud ? "in the cloud" : "on your Mac" }

    /// When the run started — `startedAt`, else (older daemon) when it was queued.
    var startedStamp: String { startedAt ?? createdAt }

    var stateLabel: String {
        switch state {
        case "queued": return "Queued"
        case "dispatched": return "Starting"
        case "running": return "Running"
        case "pr-open": return "Ready to merge"
        case "merged": return "Merged"
        case "failed": return "Failed"
        case "cancelled": return "Cancelled"
        default: return state.capitalized
        }
    }

    var stateColor: Color {
        switch state {
        case "pr-open", "merged": return Theme.ready
        case "failed": return Theme.red
        case "running", "dispatched": return Theme.accent
        default: return Theme.dim
        }
    }

    /// "checks passed" / "checks failing" / "checks running"; nil when unknown.
    var checksLabel: String? {
        switch pr?.checks {
        case "passing": return "checks passed"
        case "failing": return "checks failing"
        case "pending": return "checks running"
        default: return nil
        }
    }
}

// MARK: - Surfaces

extension View {
    /// The queue's card: the panel surface with a hairline tinted by its bucket.
    func queueCard(tint: Color? = nil, padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .strokeBorder(tint.map { $0.opacity(0.35) } ?? Theme.hairline, lineWidth: 1)
            )
    }
}

/// An uppercase bucket heading with its dot: "● NEEDS YOU · 2".
struct QueueSectionHeader: View {
    var title: String
    var count: Int
    var color: Color
    /// Hollow dot (Running) instead of a filled one.
    var hollow = false
    var note: String? = nil

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if hollow {
                    Circle().strokeBorder(color, lineWidth: 1.5)
                } else {
                    Circle().fill(color)
                }
            }
            .frame(width: 8, height: 8)
            Text("\(title) · \(count)")
                .font(.caption.weight(.semibold))
                .tracking(0.6)
                .textCase(.uppercase)
                .foregroundStyle(color)
            Spacer()
            if let note {
                Text(note).font(.caption).monospacedDigit().foregroundStyle(Theme.dim)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// "#52 · celiador-editor" (mono) on the left, "Mac · 4 min" on the right.
/// The elapsed part ticks while the run is in flight.
struct TaskMetaRow: View {
    var task: AgentTask
    var leading: String? = nil
    var showElapsed = true

    var body: some View {
        HStack(spacing: 8) {
            Text(leading ?? task.metaPrefix)
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            if showElapsed {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(trailing(now: context.date))
                }
            } else {
                Text(task.runnerLabel)
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.dim)
    }

    private func trailing(now: Date) -> String {
        let end = task.isFinished || task.state == "pr-open" ? (task.finishedAt ?? task.updatedAt) : nil
        guard let elapsed = RelativeTime.elapsed(from: task.startedStamp, to: end, now: now) else { return task.runnerLabel }
        return "\(task.runnerLabel) · \(elapsed)"
    }
}

/// "+64 −11 3 files · checks passed" — every unknown piece is left out.
struct PullRequestStatsLine: View {
    var task: AgentTask

    var body: some View {
        HStack(spacing: 10) {
            if let adds = task.pr?.additions { Text("+\(adds)").foregroundStyle(Theme.added) }
            if let dels = task.pr?.deletions { Text("−\(dels)").foregroundStyle(Theme.red) }
            let rest = restParts
            if !rest.isEmpty {
                Text(rest.joined(separator: " · ")).foregroundStyle(task.pr?.mergeable == false || task.pr?.checks == "failing" ? Theme.red : Theme.dim)
            }
        }
        .font(.caption.monospaced())
        .lineLimit(1)
    }

    private var restParts: [String] {
        var parts: [String] = []
        if let files = task.pr?.changedFiles { parts.append("\(files) file\(files == 1 ? "" : "s")") }
        if let checks = task.checksLabel { parts.append(checks) }
        if task.pr?.mergeable == false { parts.append("conflicts") }
        if parts.isEmpty && task.pr?.additions == nil && task.pr?.deletions == nil { parts.append("Pull request ready") }
        return parts
    }
}

/// A permission's command in a code box.
struct CommandBox: View {
    var text: String
    var preview: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(text)
                .font(.footnote.monospaced())
                .foregroundStyle(Theme.ink)
            if let preview, !preview.isEmpty {
                Text(preview)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.dim)
                    .lineLimit(5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// Deny / Allow, 44pt tall, side by side. Borderless so they work inside a List row.
struct PermissionButtons: View {
    var busy = false
    var onDecide: (Bool) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button { onDecide(false) } label: {
                Text("Deny")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            }
            .buttonStyle(.borderless)
            .foregroundStyle(Theme.ink)
            Button { onDecide(true) } label: {
                Text("Allow")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onFill)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Theme.attention, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
        }
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }
}

// MARK: - Actions

/// The calls both screens make for a task. New daemon endpoints first; on a 404
/// (an older daemon) they fall back to the equivalent session relay call.
@MainActor
enum TaskActions {
    /// Allow / deny the permission the task's session is blocked on.
    static func decide(_ task: AgentTask, requestId: String, approve: Bool, model: AppModel) async throws {
        guard let sid = task.sessionId else { throw Api.ApiError(message: "This run has no live session.") }
        model.handledRequests.insert(requestId)
        Telemetry.signal(.phoneCommand, ["command": approve ? "approve" : "reject"])
        do {
            try await Api.shared.resolveApproval(sid, requestId: requestId, approve: approve)
        } catch {
            model.handledRequests.remove(requestId)
            throw error
        }
    }

    /// Answer the question the task's session asked.
    static func answer(_ task: AgentTask, requestId: String, text: String, model: AppModel) async throws {
        guard let sid = task.sessionId else { throw Api.ApiError(message: "This run has no live session.") }
        model.handledRequests.insert(requestId)
        Telemetry.signal(.phoneCommand, ["command": "answer"])
        do {
            try await Api.shared.answer(sid, requestId: requestId, text: text)
        } catch {
            model.handledRequests.remove(requestId)
            throw error
        }
    }

    /// "Approve and merge". Returns whether GitHub merged it.
    static func merge(_ task: AgentTask) async throws -> Bool {
        Telemetry.signal(.phoneCommand, ["command": "merge"])
        do {
            return try await Api.shared.mergeTask(task.id).merged
        } catch let error as Api.ApiError where error.status == 404 {
            guard let sid = task.sessionId else { throw error }
            return try await Api.shared.gitMergePullRequest(sessionId: sid).merged
        }
    }

    /// "Send it back with a follow-up".
    static func followUp(_ task: AgentTask, text: String) async throws {
        Telemetry.signal(.phoneCommand, ["command": "followup"])
        do {
            try await Api.shared.followUpTask(task.id, text: text)
        } catch let error as Api.ApiError where error.status == 404 {
            guard let sid = task.sessionId else { throw error }
            try await Api.shared.sendMessage(sid, text: text)
        }
    }
}
