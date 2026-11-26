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
                    message: "Tell the agent what to change on one of your repos. It works on its own branch and comes back with a pull request you can merge from here.",
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
                Button { Haptics.tap(); model.selectedTab = .settings } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Settings")
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
        .sheet(isPresented: $showNew) { NewTaskSheet { title in toast = "Queued: \(title)"; Task { await reload() } }.trackScreen(.newTask) }
        .sheet(isPresented: $showRepos) { WatchedReposSheet(watched: $model.watchedRepos).trackScreen(.watchedRepos) }
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

    /// "merged · $0.38" / "failed: tests failed · <$0.01" — the cost closes the line
    /// when the daemon attributed one to the run.
    private func finishedLine(_ task: AgentTask) -> String {
        let outcome: String
        switch task.state {
        case "merged": outcome = "merged"
        case "failed": outcome = task.error.map { "failed: \($0)" } ?? "failed"
        default: outcome = "cancelled"
        }
        guard let cost = task.settledCost else { return outcome }
        return "\(outcome) · \(cost)"
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
                    Telemetry.signal(.pullRequestMerged, ["merged": merged ? "true" : "false"])
                    merged ? Haptics.success() : Haptics.warning()
                    toast = merged ? "Merged" : "Not merged"
                    await reload()
                } catch {
                    Telemetry.error(.git, "merge", error)
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
                    Telemetry.signal(.taskCancelled)
                    toast = "Cancelled"
                    await reload()
                } catch {
                    Telemetry.error(.tasks, "cancel", error)
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

/// A repo a task can be queued on: one of your linked repos (the cloud can run it
/// when the GitHub App is on it), one an editor has open (runs there), or both.
private struct RepoChoice: Identifiable, Hashable {
    let url: String
    let label: String
    var openInEditor: Bool
    var cloudReady: Bool
    var id: String { url }

    /// Where a task on this repo will run, in plain words.
    var runsWhere: String {
        switch (openInEditor, cloudReady) {
        case (true, true): return "Runs in Celiador on your computer while it has the repo open, otherwise in the cloud. Ends in a pull request."
        case (true, false): return "Runs in Celiador on your computer, where the repo is open. Ends in a pull request."
        case (false, true): return "Runs in the cloud, no computer needed. Ends in a pull request you can merge from here."
        case (false, false): return "Waits until Celiador on a computer opens this repo. Install the Celiador GitHub App on it to run it in the cloud instead."
        }
    }

    /// Linked repos and editor workspaces as one list, matched by URL (case and `.git` ignored).
    static func merge(cloud: [CloudRepo], editor: [EditorWorkspace]) -> [RepoChoice] {
        func key(_ url: String) -> String {
            var k = url.lowercased()
            while k.hasSuffix("/") { k.removeLast() }
            if k.hasSuffix(".git") { k.removeLast(4) }
            return k
        }
        var byKey: [String: RepoChoice] = [:]
        var order: [String] = []
        for repo in cloud {
            let k = key(repo.url)
            if byKey[k] == nil { order.append(k) }
            byKey[k] = RepoChoice(url: repo.url, label: repo.label, openInEditor: false, cloudReady: repo.cloudReady)
        }
        for ws in editor where ws.remoteUrl.lowercased().hasPrefix("https://github.com/") {
            let k = key(ws.remoteUrl)
            if byKey[k] != nil {
                byKey[k]?.openInEditor = true
            } else {
                order.append(k)
                byKey[k] = RepoChoice(url: ws.remoteUrl, label: RepoRecents.shortLabel(ws.remoteUrl), openInEditor: true, cloudReady: false)
            }
        }
        // Runnable now first (open in an editor or cloud-ready), then the rest; by name within each.
        return order.compactMap { byKey[$0] }.sorted {
            let a = $0.openInEditor || $0.cloudReady, b = $1.openInEditor || $1.cloudReady
            return a != b ? a : $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        }
    }
}

/// Start a task by hand on one of your repos (cloud) or one an editor has open.
private struct NewTaskSheet: View {
    var onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var repos: [RepoChoice] = []
    @State private var loaded = false
    @State private var repo: String = ""
    @State private var title = ""
    @State private var details = ""
    @State private var sending = false
    @State private var error: String?

    private var picked: RepoChoice? { repos.first { $0.url == repo } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if !loaded {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if repos.isEmpty {
                        Text("No repos yet. Add one in Celiador with Connect GitHub, or open it there, and it shows up here.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Picker("Repo", selection: $repo) {
                            ForEach(repos) { r in Text(r.label).tag(r.url) }
                        }
                    }
                } header: {
                    Text("Repository")
                } footer: {
                    if let picked { Text(picked.runsWhere) }
                }
                .listRowBackground(Theme.panel)
                Section("Task") {
                    TextField("What should change?", text: $title, axis: .vertical).lineLimit(1...3)
                    TextField("Details (optional)", text: $details, axis: .vertical).lineLimit(3...8)
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
                async let cloud = Api.shared.cloudRepos()
                let editor = (try? await Api.shared.editorWorkspaces()) ?? []
                if !editor.isEmpty { Telemetry.onboarding(.editorPaired) }
                repos = RepoChoice.merge(cloud: (try? await cloud) ?? [], editor: editor)
                loaded = true
                if repo.isEmpty { repo = repos.first?.url ?? "" }
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
                Telemetry.error(.tasks, "create", error)
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
    @State private var repos: [RepoChoice] = []
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
                        Text("Your repos show up here once you add them in Celiador with Connect GitHub, or open them there.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(repos) { r in
                        Toggle(r.label, isOn: Binding(
                            get: { isWatched(r.url) },
                            set: { on in Task { await set(r.url, on) } }
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
                async let cloud = Api.shared.cloudRepos()
                let editor = (try? await Api.shared.editorWorkspaces()) ?? []
                repos = RepoChoice.merge(cloud: (try? await cloud) ?? [], editor: editor)
            }
        }
    }

    private func set(_ url: String, _ on: Bool) async {
        do {
            watched = try await Api.shared.setRepoWatched(url, watched: on)
            Telemetry.signal(.repoWatchToggled, ["watched": on ? "true" : "false"])
            error = nil
        } catch {
            Telemetry.error(.tasks, "watch", error)
            self.error = (error as NSError).localizedDescription
        }
    }
}
