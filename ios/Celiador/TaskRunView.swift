import SwiftUI
import Observation

// MARK: - What the agent did (a checklist summarised from the session's tool events)

/// One line of the run's checklist.
struct RunStep: Identifiable, Equatable {
    let id: Int
    let text: String
    /// true done, false failed, nil still in progress.
    let ok: Bool?
}

/// Folds a session's event log into a short human checklist: consecutive reads,
/// edits, searches and commands collapse into one line each ("Read
/// SessionView.swift and Api.swift", "Edited 3 files", "Ran xcodebuild … build"),
/// errors stay visible, and the pull request closes it off.
enum RunSummary {
    private enum Kind: Equatable { case read, search, edit, run, other(String) }

    private struct Group {
        var kind: Kind
        var paths: [String] = []
        var commands: [String] = []
        var calls = 0
        var callIds: [String] = []
        var failed = false
        var firstSeq: Int
        var error: String? = nil
    }

    private static func kind(of name: String) -> Kind? {
        let n = name.lowercased()
        func has(_ needles: [String]) -> Bool { needles.contains { n.contains($0) } }
        if has(["todo", "think", "task_complete"]) { return nil }
        if has(["grep", "glob", "search", "find"]) { return .search }
        if has(["write", "edit", "replace", "create", "patch", "insert", "notebook"]) { return .edit }
        if has(["bash", "shell", "terminal", "run", "exec", "command"]) { return .run }
        if has(["read", "view", "list", "ls", "cat", "open", "get_file", "fetch"]) { return .read }
        return .other(name)
    }

    private static func fileName(_ path: String) -> String {
        (path as NSString).lastPathComponent.isEmpty ? path : (path as NSString).lastPathComponent
    }

    /// "xcodebuild -scheme Celiador … build" → "xcodebuild … build" when long.
    static func abbreviate(_ command: String) -> String {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstLine = trimmed.split(separator: "\n").first.map(String.init) ?? trimmed
        let words = firstLine.split(separator: " ")
        guard firstLine.count > 28, words.count > 2, let first = words.first, let last = words.last else { return firstLine }
        return "\(first) … \(last)"
    }

    private static func names(_ paths: [String]) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for p in paths.map(fileName) where seen.insert(p).inserted { out.append(p) }
        return out
    }

    private static func list(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        case 2: return "\(items[0]) and \(items[1])"
        default: return "\(items[0]), \(items[1]) and \(items.count - 2) more"
        }
    }

    private static func text(for g: Group) -> String {
        if let error = g.error { return error }
        let files = names(g.paths)
        switch g.kind {
        case .read:
            if files.isEmpty { return g.calls == 1 ? "Read a file" : "Read \(g.calls) files" }
            return "Read \(list(files))"
        case .search:
            return "Searched the code"
        case .edit:
            if files.isEmpty { return g.calls == 1 ? "Made an edit" : "Made \(g.calls) edits" }
            return files.count <= 2 ? "Edited \(list(files))" : "Edited \(files.count) files"
        case .run:
            if g.commands.count == 1 { return "Ran \(abbreviate(g.commands[0]))" }
            if g.commands.count > 1 { return "Ran \(g.commands.count) commands, last \(abbreviate(g.commands.last!))" }
            return g.calls == 1 ? "Ran a command" : "Ran \(g.calls) commands"
        case .other(let name):
            return g.calls == 1 ? "Used \(name)" : "Used \(name) \(g.calls) times"
        }
    }

    static func steps(events: [SessionEvent], task: AgentTask?) -> [RunStep] {
        var groups: [Group] = []
        var groupByCallId: [String: Int] = [:]

        func append(_ kind: Kind, seq: Int, path: String?, command: String?, callId: String?) {
            if let last = groups.indices.last, groups[last].kind == kind, groups[last].error == nil {
                if let path { groups[last].paths.append(path) }
                if let command { groups[last].commands.append(command) }
                groups[last].calls += 1
                if let callId { groupByCallId[callId] = last }
            } else {
                var g = Group(kind: kind, firstSeq: seq)
                if let path { g.paths.append(path) }
                if let command { g.commands.append(command) }
                g.calls = 1
                groups.append(g)
                if let callId { groupByCallId[callId] = groups.count - 1 }
            }
        }

        for e in events {
            switch e.kind {
            case "tool":
                guard let k = kind(of: e.name ?? "tool") else { continue }
                let path = e.input?["path"] ?? e.input?["file_path"] ?? e.input?["filePath"] ?? e.input?["dir"]
                let command = e.input?["command"] ?? e.input?["cmd"]
                append(k, seq: e.seq, path: path, command: command, callId: e.callId)
            case "diff":
                // A diff is the evidence of an edit: fold its path into the edit line.
                if let path = e.path {
                    if let last = groups.indices.last, groups[last].kind == .edit {
                        if !groups[last].paths.contains(path) { groups[last].paths.append(path) }
                    } else {
                        append(.edit, seq: e.seq, path: path, command: nil, callId: nil)
                    }
                }
            case "toolResult":
                if let cid = e.callId, let i = groupByCallId[cid], e.ok == false { groups[i].failed = true }
            case "error":
                var g = Group(kind: .other("error"), firstSeq: e.seq)
                g.error = e.message ?? "Something went wrong"
                g.failed = true
                groups.append(g)
            default:
                continue
            }
        }

        let live = task?.isActive ?? false
        var steps = groups.enumerated().map { i, g in
            RunStep(id: g.firstSeq, text: text(for: g), ok: g.failed ? false : (live && i == groups.count - 1 ? nil : true))
        }
        if let task, task.prNumber != nil || task.prUrl != nil {
            steps.append(RunStep(id: Int.max - 1, text: "Opened the pull request", ok: true))
        }
        if task?.state == "merged" {
            steps.append(RunStep(id: Int.max, text: "Merged", ok: true))
        }
        return steps
    }
}

/// Replays the linked session's event log (SSE, from the start) for the run
/// screen: the raw events for the checklist and the diffs the run streamed.
@MainActor
@Observable
final class RunEventLog {
    var events: [SessionEvent] = []
    var diffs: [DiffFile] = []
    var loaded = false

    private var stream: SessionEventStream?
    private var sessionId: String?

    func start(sessionId: String) {
        guard stream == nil || self.sessionId != sessionId else { return }
        stop()
        self.sessionId = sessionId
        events = []
        diffs = []
        let s = SessionEventStream(sessionId: sessionId, since: 0) { [weak self] e in self?.ingest(e) }
        stream = s
        s.start()
        // Mark loaded shortly after: an empty log just means there's nothing to show.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            self?.loaded = true
        }
    }

    func stop() {
        stream?.stop()
        stream = nil
    }

    #if DEBUG
    func seed(events: [SessionEvent], diffs: [DiffFile]) {
        self.events = events
        self.diffs = diffs
        loaded = true
    }
    #endif

    private func ingest(_ e: SessionEvent) {
        switch e.kind {
        case "tool", "toolResult", "error":
            events.append(e)
        case "diff":
            events.append(e)
            let file = DiffFile(id: e.seq, path: e.path ?? "(file)", patch: e.patch ?? "")
            // Keep the latest patch per path.
            if let i = diffs.firstIndex(where: { $0.path == file.path }) { diffs[i] = file } else { diffs.append(file) }
        default:
            break
        }
        loaded = true
    }
}

// MARK: - One run

/// One agent task, end to end: what it is, where it ran, what the agent did,
/// the changes, and the two ways out — send it back with a follow-up, or
/// approve and merge its pull request.
struct TaskRunView: View {
    let taskId: String

    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var log = RunEventLog()
    @State private var liveDiffs: [DiffFile] = []
    @State private var followUp = ""
    @State private var answerText = ""
    @State private var sending = false
    @State private var merging = false
    @State private var confirmMerge = false
    @State private var showChanges = false
    @State private var busyRequest: String?
    @State private var toast: String?
    @FocusState private var followUpFocused: Bool

    private var task: AgentTask? { model.tasks.first { $0.id == taskId } }

    var body: some View {
        Group {
            if let task {
                content(task)
            } else if model.tasksLoaded {
                EmptyStateView(icon: "questionmark.folder", title: "Run not found", message: "This task isn't in your queue any more.")
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CeliadorBackground())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // A focused screen with its own bottom actions: the tab bar steps aside.
        .toolbar(.hidden, for: .tabBar)
        .toast($toast)
        .task(id: task?.sessionId) { startLog() }
        .task { if task == nil { await model.refreshTasks() } }
        .onDisappear { log.stop() }
    }

    private func startLog() {
        #if DEBUG
        if DemoData.isActive {
            log.seed(events: DemoData.runEvents(taskId: taskId), diffs: DemoData.runDiffs(taskId: taskId))
            return
        }
        #endif
        guard let sid = task?.sessionId else { return }
        log.start(sessionId: sid)
        // No streamed diffs (yet): ask the editor's working copy, for runs still in flight.
        Task {
            try? await Task.sleep(for: .seconds(2))
            guard log.diffs.isEmpty, task?.isActive == true, !(task?.isCloud ?? false),
                  let live = try? await DiffStats.loadLive(sessionId: sid) else { return }
            let (status, patches) = live
            liveDiffs = status.files.enumerated().map { DiffFile(id: $0.offset, path: $0.element.path, patch: patches[$0.element.path] ?? "") }
        }
    }

    private var diffs: [DiffFile] { log.diffs.isEmpty ? liveDiffs : log.diffs }

    // MARK: Layout

    private func content(_ task: AgentTask) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(task)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                Divider().overlay(Theme.hairline)
                VStack(alignment: .leading, spacing: 14) {
                    if let awaiting = task.awaiting, !model.handledRequests.contains(awaiting.requestId) {
                        awaitingCard(task, awaiting)
                    } else if model.needsYou(task), let sid = task.sessionId {
                        Button { model.queuePath.append(.session(sid)) } label: {
                            Label("The agent is waiting for you — open the run", systemImage: "hand.raised.fill")
                                .font(.subheadline.weight(.medium))
                        }
                        .tint(Theme.attention)
                    }
                    if task.state == "failed", let error = task.error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Theme.red)
                    }
                    stepsSection(task)
                    changesSection(task)
                }
                .padding(16)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar(task) }
        .sheet(isPresented: $showChanges) {
            ChangesView(
                title: task.title,
                diffs: diffs,
                liveSessionId: task.isActive && !task.isCloud ? task.sessionId : nil
            )
        }
        .confirmationDialog(
            task.prNumber.map { "Merge pull request #\($0)?" } ?? "Merge the pull request?",
            isPresented: $confirmMerge,
            titleVisibility: .visible
        ) {
            Button("Approve and merge") { merge(task) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("“\(task.title)” merges into \(task.repo.name)'s default branch on GitHub.")
        }
    }

    private func header(_ task: AgentTask) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(metaLine(task))
                .font(.caption.monospaced())
                .foregroundStyle(Theme.dim)
                .lineLimit(2)
            Text(task.title)
                .font(.title2.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                StatusPill(text: model.needsYou(task) ? "Needs you" : task.stateLabel, color: model.needsYou(task) ? Theme.attention : task.stateColor)
                if let number = task.prNumber {
                    Button {
                        if let url = task.pullRequestURL { openURL(url) }
                    } label: {
                        NeutralPill(text: "PR #\(number)", icon: "arrow.up.right")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open pull request \(number) on GitHub")
                }
                if let cost = task.settledCost {
                    NeutralPill(text: cost)
                        .accessibilityLabel("Cost \(cost)")
                }
            }
            // "Ran on Stefan's MacBook Pro · 12 min · $0.38" / "Running in the cloud · 4 min".
            TimelineView(.periodic(from: .now, by: 30)) { context in
                Text(runnerLine(task, now: context.date))
                    .font(.footnote)
                    .foregroundStyle(Theme.dim)
                    .lineLimit(2)
            }
        }
        .padding(.top, 4)
    }

    private func metaLine(_ task: AgentTask) -> String {
        task.branch.isEmpty ? task.metaPrefix : "\(task.metaPrefix) · branch \(task.branch)"
    }

    /// Where it ran, for how long, and what it cost once that figure is settled.
    /// A cloud run never reads as "your Mac": the place follows `isCloud` first,
    /// and the machine name only applies to an editor dispatch.
    private func runnerLine(_ task: AgentTask, now: Date) -> String {
        let finished = task.isFinished || task.state == "pr-open"
        let verb = finished ? "Ran" : (task.state == "queued" ? "Queued" : "Running")
        let place: String
        if task.isCloud {
            place = "in the cloud"
        } else if let machine = task.machine, !machine.isEmpty {
            place = "on \(machine)"
        } else {
            place = "on your Mac"
        }
        var parts = ["\(verb) \(place)"]
        let end = finished ? (task.finishedAt ?? task.updatedAt) : nil
        if task.state != "queued", let elapsed = RelativeTime.elapsed(from: task.startedStamp, to: end, now: now) {
            parts.append(elapsed)
        }
        if let cost = task.settledCost { parts.append(cost) }
        return parts.joined(separator: " · ")
    }

    // MARK: Needs you

    @ViewBuilder
    private func awaitingCard(_ task: AgentTask, _ awaiting: AgentTask.Awaiting) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            QueueSectionHeader(title: awaiting.isPermission ? "Needs your permission" : "The agent asks", count: 1, color: Theme.attention)
            if awaiting.isPermission {
                CommandBox(text: awaiting.text, preview: awaiting.preview)
                PermissionButtons(busy: busyRequest == awaiting.requestId) { approve in decide(task, awaiting, approve) }
            } else {
                Text(awaiting.text).font(.subheadline)
                if let choices = awaiting.choices, !choices.isEmpty {
                    ForEach(choices, id: \.self) { choice in
                        Button { answer(task, awaiting, choice) } label: {
                            Text(choice)
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 12)
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack(spacing: 8) {
                    TextField("Your answer", text: $answerText, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.horizontal, 12).padding(.vertical, 11)
                        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    SquareSendButton(enabled: !answerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && busyRequest == nil) {
                        answer(task, awaiting, answerText)
                    }
                    .accessibilityLabel("Send answer")
                }
            }
        }
        .queueCard(tint: Theme.attention)
    }

    // MARK: What the agent did

    @ViewBuilder
    private func stepsSection(_ task: AgentTask) -> some View {
        let steps = RunSummary.steps(events: log.events, task: task)
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("What the agent did")
            if steps.isEmpty {
                Text(task.sessionId == nil
                     ? (task.state == "queued" ? "Nothing yet — it starts when \(task.isCloud ? "a cloud runner" : "your Mac") picks it up." : "No steps recorded for this run.")
                     : (log.loaded ? "No tool steps recorded yet." : "Loading the run…"))
                    .font(.subheadline)
                    .foregroundStyle(Theme.dim)
            } else {
                ForEach(steps.suffix(10)) { step in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Group {
                            switch step.ok {
                            case .some(true): Text("✓").foregroundStyle(Theme.ready)
                            case .some(false): Text("✗").foregroundStyle(Theme.red)
                            case .none: ProgressView().controlSize(.mini)
                            }
                        }
                        .font(.subheadline.monospaced())
                        .frame(width: 16)
                        Text(step.text).font(.subheadline)
                    }
                }
            }
            if let sid = task.sessionId {
                Button { Haptics.tap(); model.queuePath.append(.session(sid)) } label: {
                    Label("Full transcript", systemImage: "text.bubble")
                        .font(.subheadline.weight(.medium))
                        .frame(minHeight: 32)
                }
                .buttonStyle(.borderless)
            }
        }
    }

    // MARK: Changes

    @ViewBuilder
    private func changesSection(_ task: AgentTask) -> some View {
        let files = diffs
        let count = files.isEmpty ? (task.pr?.changedFiles ?? 0) : files.count
        if count > 0 || !files.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionTitle("Changes · \(count) file\(count == 1 ? "" : "s")")
                    .padding(.top, 4)
                if files.isEmpty {
                    // Only the pull request's numbers are known (no streamed diffs).
                    Button { if let url = task.pullRequestURL { openURL(url) } } label: {
                        HStack {
                            PullRequestStatsLine(task: task, showCost: false) // the header pill has it
                            Spacer()
                            Text("View on GitHub").font(.footnote.weight(.medium))
                            Image(systemName: "arrow.up.right").font(.caption)
                        }
                        .queueCard(padding: 12)
                    }
                    .buttonStyle(.plain)
                } else {
                    Button { Haptics.tap(); showChanges = true } label: { changesCard(files) }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens the full diff")
                }
            }
        }
    }

    private func changesCard(_ files: [DiffFile]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(files.prefix(8).enumerated()), id: \.element.id) { index, file in
                let counts = DiffStats.counts(file.patch)
                if index > 0 { Divider().overlay(Theme.hairline) }
                HStack {
                    Text((file.path as NSString).lastPathComponent)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 8)
                    Text("+\(counts.added)").foregroundStyle(Theme.added)
                    Text("−\(counts.removed)").foregroundStyle(Theme.red)
                }
                .font(.caption.monospaced())
                .padding(.horizontal, 12).padding(.vertical, 10)
                let hunk = DiffStats.firstHunk(file.patch, maxLines: 4)
                if !hunk.isEmpty {
                    Divider().overlay(Theme.hairline)
                    DiffBody(patch: hunk)
                        .allowsHitTesting(false)
                }
            }
            if files.count > 8 {
                Divider().overlay(Theme.hairline)
                Text("\(files.count - 8) more file\(files.count - 8 == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
                    .padding(12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(Theme.dim)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: Bottom: follow-up + merge

    private func canFollowUp(_ task: AgentTask) -> Bool {
        task.sessionId != nil && !["merged", "cancelled"].contains(task.state)
    }

    private func canMerge(_ task: AgentTask) -> Bool {
        task.state == "pr-open" && task.pr?.mergeable != false && !merging
    }

    @ViewBuilder
    private func bottomBar(_ task: AgentTask) -> some View {
        if canFollowUp(task) || task.state == "pr-open" || task.isActive {
            VStack(alignment: .leading, spacing: 10) {
                if canFollowUp(task) {
                    Text("Send it back with a follow-up")
                        .font(.caption)
                        .foregroundStyle(Theme.dim)
                    HStack(spacing: 8) {
                        TextField("What should change?", text: $followUp, axis: .vertical)
                            .lineLimit(1...4)
                            .focused($followUpFocused)
                            .padding(.horizontal, 12).padding(.vertical, 11)
                            .frame(minHeight: 44)
                            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                        SquareSendButton(enabled: !sending && !followUp.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                            sendFollowUp(task)
                        }
                        .accessibilityLabel("Send follow-up")
                    }
                }
                Button { Haptics.tap(); confirmMerge = true } label: {
                    HStack(spacing: 8) {
                        if merging { ProgressView().tint(Theme.onFill) }
                        Text(mergeTitle(task)).font(.body.weight(.semibold))
                    }
                    .foregroundStyle(canMerge(task) ? Theme.onFill : Theme.dim)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(canMerge(task) ? Theme.ready : Theme.panelHi, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canMerge(task))
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(alignment: .top) {
                Theme.panel
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .top) { Divider().overlay(Theme.hairline) }
            }
        }
    }

    private func mergeTitle(_ task: AgentTask) -> String {
        if merging { return "Merging…" }
        switch task.state {
        case "pr-open": return task.pr?.mergeable == false ? "Conflicts — resolve on GitHub" : "Approve and merge"
        case "failed": return "No pull request to merge"
        default: return "Approve and merge when the PR opens"
        }
    }

    // MARK: Actions

    private func decide(_ task: AgentTask, _ awaiting: AgentTask.Awaiting, _ approve: Bool) {
        approve ? Haptics.success() : Haptics.warning()
        #if DEBUG
        if DemoData.isActive { model.handledRequests.insert(awaiting.requestId); toast = approve ? "Allowed" : "Denied"; return }
        #endif
        busyRequest = awaiting.requestId
        Task {
            do {
                try await TaskActions.decide(task, requestId: awaiting.requestId, approve: approve, model: model)
                toast = approve ? "Allowed" : "Denied"
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
            busyRequest = nil
            await model.refreshTasks()
        }
    }

    private func answer(_ task: AgentTask, _ awaiting: AgentTask.Awaiting, _ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Haptics.tap()
        busyRequest = awaiting.requestId
        Task {
            do {
                try await TaskActions.answer(task, requestId: awaiting.requestId, text: trimmed, model: model)
                answerText = ""
                toast = "Answered"
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
            busyRequest = nil
            await model.refreshTasks()
        }
    }

    private func sendFollowUp(_ task: AgentTask) {
        let text = followUp.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Haptics.tap()
        sending = true
        Task {
            do {
                try await TaskActions.followUp(task, text: text)
                followUp = ""
                followUpFocused = false
                Haptics.success()
                toast = "Sent back to the agent"
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
            sending = false
            await model.refreshTasks()
        }
    }

    private func merge(_ task: AgentTask) {
        merging = true
        Task {
            do {
                let merged = try await TaskActions.merge(task)
                merged ? Haptics.success() : Haptics.warning()
                toast = merged ? "Merged" : "GitHub didn't merge it"
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
            merging = false
            // The task stream moves it to merged; re-list too in case the stream is down.
            await model.refreshTasks()
        }
    }
}

/// A neutral metadata capsule ("PR #8", "$0.38").
struct NeutralPill: View {
    var text: String
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 4) {
            Text(text).font(.caption)
            if let icon { Image(systemName: icon).font(.caption2) }
        }
        .foregroundStyle(Theme.ink.opacity(0.8))
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(Theme.panelHi, in: Capsule())
        .lineLimit(1)
    }
}

/// The 44pt square arrow button beside a text field.
struct SquareSendButton: View {
    var enabled: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.right")
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 44, height: 44)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(enabled ? Theme.ink : Theme.faint)
        .disabled(!enabled)
    }
}
