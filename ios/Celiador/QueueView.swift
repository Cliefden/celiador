import SwiftUI

/// The agent queue, the app's home: what needs you (permissions to grant and
/// questions to answer, inline), the pull requests ready to merge, what is
/// running, and recent finished work. Tasks come from GitHub issues (label
/// `celiador`, or an `@celiador` comment) on watched repos, or are started here;
/// the daemon hands each to the editor, which runs it in its own worktree and
/// opens a pull request. A card opens the task's One-run screen.
struct QueueView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    @State private var toast: String?
    @State private var showNew = false
    @State private var showRepos = false
    @State private var showAccount = false
    @State private var busyRequests: Set<String> = []

    private var needsYou: [AgentTask] { model.needsYouTasks }
    private var looseAwaiting: [Session] { model.looseAwaitingSessions }
    private var ready: [AgentTask] { model.readyTasks }
    private var running: [AgentTask] { model.runningTasks.filter { $0.state != "queued" } }
    private var waiting: [AgentTask] { model.runningTasks.filter { $0.state == "queued" } }
    private var finished: [AgentTask] { Array(model.finishedTasks.prefix(6)) }

    private var isEmpty: Bool {
        model.tasks.isEmpty && looseAwaiting.isEmpty
    }

    var body: some View {
        @Bindable var model = model
        Group {
            if model.tasksLoaded && isEmpty {
                EmptyStateView(
                    icon: "tray",
                    title: "Nothing queued",
                    message: "Label a GitHub issue `celiador` on a watched repo, or start a task here. Each runs on your Mac in its own worktree and ends in a pull request.",
                    actionTitle: "Start a task",
                    action: { showNew = true }
                )
                .padding(24)
            } else {
                List {
                    titleHeader
                        .plainCardRow(top: 0, bottom: 6)

                    if !needsYou.isEmpty || !looseAwaiting.isEmpty {
                        QueueSectionHeader(title: "Needs you", count: needsYou.count + looseAwaiting.count, color: Theme.attention)
                            .plainCardRow(top: 10, bottom: 0)
                        ForEach(needsYou) { task in
                            needsYouCard(task)
                                .plainCardRow()
                                .swipeActions { cancelButton(task) }
                        }
                        ForEach(looseAwaiting) { session in
                            looseSessionCard(session)
                                .plainCardRow()
                        }
                    }

                    if !ready.isEmpty {
                        QueueSectionHeader(title: "Ready to merge", count: ready.count, color: Theme.ready)
                            .plainCardRow(top: 10, bottom: 0)
                        ForEach(ready) { task in
                            readyCard(task)
                                .plainCardRow()
                                .swipeActions(edge: .leading) { mergeButton(task) }
                                .swipeActions { transcriptButton(task) }
                        }
                    }

                    if !running.isEmpty || !waiting.isEmpty {
                        QueueSectionHeader(
                            title: "Running",
                            count: running.count + waiting.count,
                            color: Theme.dim,
                            hollow: true,
                            note: model.taskConcurrency > 0 ? "\(running.count) of \(model.taskConcurrency) slots" : nil
                        )
                        .plainCardRow(top: 10, bottom: 0)
                        ForEach(running + waiting) { task in
                            runningCard(task)
                                .plainCardRow()
                                .swipeActions { cancelButton(task) }
                        }
                    }

                    if !finished.isEmpty {
                        QueueSectionHeader(title: "Recently finished", count: finished.count, color: Theme.dim, hollow: true)
                            .plainCardRow(top: 10, bottom: 0)
                        ForEach(finished) { task in
                            finishedRow(task)
                                .plainCardRow(top: 2, bottom: 2)
                        }
                    }

                    if let error = model.tasksError {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                            .plainCardRow(top: 12)
                    }
                }
                .listStyle(.plain)
                .brandGround()
                .refreshable { await reload() }
            }
        }
        .background(CeliadorBackground())
        // The large title lives in the list header (subtitle above it, as designed);
        // "Queue" stays the navigation title so pushed screens say "‹ Queue".
        .navigationTitle("Queue")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { Text("") }
            ToolbarItem(placement: .topBarLeading) {
                Button { Haptics.tap(); showAccount = true } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showRepos = true } label: { Image(systemName: "eye") }
                    .accessibilityLabel("Watched repos")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNew = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Start a task")
            }
        }
        .toast($toast)
        .sheet(isPresented: $showAccount) { AccountView() }
        .sheet(isPresented: $showNew) { NewTaskSheet { title in toast = "Queued: \(title)"; Task { await reload() } } }
        .sheet(isPresented: $showRepos) { WatchedReposSheet(watched: $model.watchedRepos) }
        // The model polls + streams tasks while signed in; load now so the tab is fresh.
        .task { await reload() }
    }

    private func reload() async {
        await model.refreshTasks()
    }

    // MARK: - Header

    /// "5 runs · 2 on your Mac · 1 in the cloud" over the large "Queue".
    private var titleHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(summaryLine)
                .font(.footnote)
                .foregroundStyle(Theme.dim)
            Text("Queue")
                .font(.largeTitle.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summaryLine: String {
        let inFlight = needsYou + running + waiting
        let total = inFlight.count + ready.count + looseAwaiting.count
        guard total > 0 else { return "Nothing in flight" }
        var parts = ["\(total) run\(total == 1 ? "" : "s")"]
        let mac = inFlight.filter { !$0.isCloud }.count + looseAwaiting.filter { $0.runner == "editor" }.count
        let cloud = inFlight.filter(\.isCloud).count + looseAwaiting.filter { $0.runner == "server" }.count
        if mac > 0 { parts.append("\(mac) on your Mac") }
        if cloud > 0 { parts.append("\(cloud) in the cloud") }
        return parts.joined(separator: " · ")
    }

    // MARK: - Cards

    private func open(_ task: AgentTask) {
        Haptics.tap()
        model.queuePath.append(.task(task.id))
    }

    @ViewBuilder
    private func needsYouCard(_ task: AgentTask) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TaskMetaRow(task: task)
            Text(task.title).font(.body.weight(.medium)).lineLimit(3)
            if let awaiting = task.awaiting {
                if awaiting.isPermission {
                    CommandBox(text: awaiting.text)
                    PermissionButtons(busy: busyRequests.contains(awaiting.requestId)) { approve in
                        decide(task, awaiting, approve)
                    }
                } else {
                    Text("Asks: “\(awaiting.text)”")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink.opacity(0.85))
                        .lineLimit(4)
                    Button("Answer") { open(task) }
                        .font(.subheadline.weight(.medium))
                        .buttonStyle(.borderless)
                        .frame(minHeight: 32)
                }
            } else {
                // Older daemon: we only know the session is blocked, not on what.
                Text("Waiting for your answer in the run")
                    .font(.subheadline)
                    .foregroundStyle(Theme.dim)
                if let sid = task.sessionId {
                    Button("Open the run") { Haptics.tap(); model.queuePath.append(.session(sid)) }
                        .font(.subheadline.weight(.medium))
                        .buttonStyle(.borderless)
                        .frame(minHeight: 32)
                }
            }
        }
        .queueCard(tint: Theme.attention)
        .contentShape(Rectangle())
        .onTapGesture { open(task) }
        .accessibilityAction(named: "Open run") { open(task) }
    }

    /// An awaiting session that isn't a task's run (a plain chat from the editor or phone).
    private func looseSessionCard(_ session: Session) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Run").font(.caption.monospaced())
                Spacer()
                Text(session.runner == "server" ? "Cloud" : "Mac")
            }
            .font(.caption)
            .foregroundStyle(Theme.dim)
            Text(session.title).font(.body.weight(.medium)).lineLimit(3)
            Text("Waiting for your answer")
                .font(.subheadline)
                .foregroundStyle(Theme.dim)
        }
        .queueCard(tint: Theme.attention)
        .contentShape(Rectangle())
        .onTapGesture { Haptics.tap(); model.queuePath.append(.session(session.id)) }
        .accessibilityAddTraits(.isButton)
    }

    private func readyCard(_ task: AgentTask) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TaskMetaRow(task: task, leading: task.prNumber.map { "\(task.metaPrefix) · PR #\($0)" }, showElapsed: false)
            Text(task.title).font(.body.weight(.medium)).lineLimit(3)
            PullRequestStatsLine(task: task)
        }
        .queueCard(tint: Theme.ready)
        .contentShape(Rectangle())
        .onTapGesture { open(task) }
        .accessibilityAddTraits(.isButton)
    }

    private func runningCard(_ task: AgentTask) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TaskMetaRow(task: task, showElapsed: task.state != "queued")
            Text(task.title).font(.body.weight(.medium)).lineLimit(2)
            Text(activityLine(task))
                .font(.footnote)
                .foregroundStyle(Theme.dim)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .queueCard(padding: 12)
        .contentShape(Rectangle())
        .onTapGesture { open(task) }
        .accessibilityAddTraits(.isButton)
    }

    private func finishedRow(_ task: AgentTask) -> some View {
        HStack(spacing: 10) {
            Image(systemName: task.state == "merged" ? "checkmark.circle.fill" : task.state == "failed" ? "xmark.circle.fill" : "minus.circle")
                .foregroundStyle(task.state == "merged" ? Theme.ready : task.state == "failed" ? Theme.red : Theme.dim)
            VStack(alignment: .leading, spacing: 1) {
                Text(task.title).font(.subheadline).lineLimit(1)
                Text("\(task.metaPrefix) · \(finishedLine(task))")
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .queueCard(padding: 10)
        .contentShape(Rectangle())
        .onTapGesture { open(task) }
        .accessibilityAddTraits(.isButton)
    }

    private func activityLine(_ task: AgentTask) -> String {
        if let line = task.activity, !line.isEmpty { return line }
        if let sid = task.sessionId, let line = model.activity[sid], !line.isEmpty { return line }
        switch task.state {
        case "queued":
            return running.count >= model.taskConcurrency && model.taskConcurrency > 0
                ? "Waiting for a free slot"
                : (task.isCloud ? "Waiting for a cloud runner" : "Waiting for your Mac to open the repo")
        case "dispatched": return "Starting \(task.runnerPhrase)"
        default: return "Working \(task.runnerPhrase)"
        }
    }

    private func finishedLine(_ task: AgentTask) -> String {
        switch task.state {
        case "merged": return "merged"
        case "failed": return task.error.map { "failed: \($0)" } ?? "failed"
        default: return "cancelled"
        }
    }

    // MARK: - Actions

    private func decide(_ task: AgentTask, _ awaiting: AgentTask.Awaiting, _ approve: Bool) {
        approve ? Haptics.success() : Haptics.warning()
        #if DEBUG
        if DemoData.isActive { model.handledRequests.insert(awaiting.requestId); toast = approve ? "Allowed" : "Denied"; return }
        #endif
        busyRequests.insert(awaiting.requestId)
        Task {
            do {
                try await TaskActions.decide(task, requestId: awaiting.requestId, approve: approve, model: model)
                toast = approve ? "Allowed" : "Denied"
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
            busyRequests.remove(awaiting.requestId)
            await reload()
        }
    }

    @ViewBuilder
    private func transcriptButton(_ task: AgentTask) -> some View {
        if let sid = task.sessionId {
            Button { model.queuePath.append(.session(sid)) } label: { Label("Transcript", systemImage: "text.bubble") }.tint(Theme.accent)
        }
    }

    /// "Approve and merge" from the card: the daemon merges the task's pull request
    /// (GitHub App, or the editor's sign-in) and moves the task to merged.
    private func mergeButton(_ task: AgentTask) -> some View {
        Button {
            Haptics.tap()
            Task {
                do {
                    let merged = try await TaskActions.merge(task)
                    merged ? Haptics.success() : Haptics.warning()
                    toast = merged ? "Merged" : "Not merged"
                    await reload()
                } catch {
                    Haptics.error()
                    toast = (error as NSError).localizedDescription
                }
            }
        } label: { Label("Merge", systemImage: "arrow.triangle.merge") }
        .tint(Theme.ready)
    }

    private func cancelButton(_ task: AgentTask) -> some View {
        Button(role: .destructive) {
            Task {
                do {
                    try await Api.shared.cancelTask(task.id)
                    toast = "Cancelled"
                    await reload()
                } catch {
                    toast = (error as NSError).localizedDescription
                }
            }
        } label: { Label("Cancel", systemImage: "xmark") }
    }
}

private extension View {
    /// A List row that is just its card: no row background, separator or system insets.
    func plainCardRow(top: CGFloat = 4, bottom: CGFloat = 4) -> some View {
        self
            .listRowInsets(EdgeInsets(top: top, leading: 16, bottom: bottom, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

/// Start a task by hand on a repo the editor has open.
private struct NewTaskSheet: View {
    var onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var repos: [EditorWorkspace] = []
    @State private var repo: String = ""
    @State private var title = ""
    @State private var details = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Repository") {
                    if repos.isEmpty {
                        Text("Open the repo in Celiador on your Mac first.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Picker("Repo", selection: $repo) {
                            ForEach(repos) { ws in Text(ws.name).tag(ws.remoteUrl) }
                        }
                    }
                }
                .listRowBackground(Theme.panel)
                Section("Task") {
                    TextField("What should change?", text: $title, axis: .vertical).lineLimit(1...3)
                    TextField("Details (optional)", text: $details, axis: .vertical).lineLimit(3...8)
                }
                .listRowBackground(Theme.panel)
                Section {
                    Text("Runs on your Mac in its own worktree and branch, and ends in a pull request.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .listRowBackground(Theme.panel)
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.red) }
            }
            .brandGround()
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if sending { ProgressView() } else {
                        Button("Queue") { create() }
                            .disabled(repo.isEmpty || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .task {
                repos = ((try? await Api.shared.editorWorkspaces()) ?? []).filter { $0.remoteUrl.lowercased().hasPrefix("https://github.com/") }
                if repo.isEmpty { repo = repos.first?.remoteUrl ?? "" }
            }
        }
    }

    private func create() {
        sending = true
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let more = details.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                try await Api.shared.createTask(remoteUrl: repo, title: trimmed, details: more.isEmpty ? nil : more)
                Telemetry.signal(.phoneRun, ["seeded": "task"])
                onCreated(trimmed)
                dismiss()
            } catch {
                self.error = (error as NSError).localizedDescription
            }
            sending = false
        }
    }
}

/// Which repos' GitHub issues become tasks for you (label `celiador`, or `@celiador`).
private struct WatchedReposSheet: View {
    @Binding var watched: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var repos: [EditorWorkspace] = []
    @State private var error: String?

    private func isWatched(_ url: String) -> Bool {
        let key = url.lowercased().replacingOccurrences(of: ".git", with: "")
        return watched.contains { $0.lowercased().replacingOccurrences(of: ".git", with: "") == key }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if repos.isEmpty {
                        Text("Repos open in Celiador on your Mac show up here.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(repos) { ws in
                        Toggle(ws.name, isOn: Binding(
                            get: { isWatched(ws.remoteUrl) },
                            set: { on in Task { await set(ws.remoteUrl, on) } }
                        ))
                        .tint(Theme.accent)
                    }
                } footer: {
                    Text("Label an issue `celiador`, or comment `@celiador` as a collaborator, and the agent picks it up. Needs the repo's Celiador webhook.")
                }
                .listRowBackground(Theme.panel)
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.red) }
            }
            .brandGround()
            .navigationTitle("Watched repos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                repos = ((try? await Api.shared.editorWorkspaces()) ?? []).filter { $0.remoteUrl.lowercased().hasPrefix("https://github.com/") }
            }
        }
    }

    private func set(_ url: String, _ on: Bool) async {
        do {
            watched = try await Api.shared.setRepoWatched(url, watched: on)
            error = nil
        } catch {
            self.error = (error as NSError).localizedDescription
        }
    }
}
