import SwiftUI

/// The agent queue, the app's home: what needs you, what is running, the pull
/// requests waiting for review, and recent finished work. Tasks come from GitHub
/// issues (label `celiador`, or an `@celiador` comment) on watched repos, or are
/// started here; the daemon hands each to the editor, which runs it in its own
/// worktree and opens a pull request.
struct QueueView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    @State private var tasks: [AgentTask] = []
    @State private var concurrency = 0
    @State private var watched: [String] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var toast: String?
    @State private var showNew = false
    @State private var showRepos = false

    private var needsYou: [Session] { model.sessions.filter { $0.state == .awaiting } }
    private var running: [AgentTask] { tasks.filter { $0.state == "dispatched" || $0.state == "running" } }
    private var waiting: [AgentTask] { tasks.filter { $0.state == "queued" } }
    private var review: [AgentTask] { tasks.filter { $0.state == "pr-open" } }
    private var finished: [AgentTask] { tasks.filter { ["merged", "failed", "cancelled"].contains($0.state) }.prefix(6).map { $0 } }

    var body: some View {
        Group {
            if loaded && tasks.isEmpty && needsYou.isEmpty {
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
                    if !needsYou.isEmpty {
                        Section {
                            ForEach(needsYou) { session in
                                NavigationLink(value: session.id) {
                                    row(title: session.title, detail: "Waiting for your answer", icon: "hand.raised.fill", color: Theme.attention, pulsing: true)
                                }
                            }
                        } header: { header("Needs you", needsYou.count) }
                    }
                    if !review.isEmpty {
                        Section {
                            ForEach(review) { task in
                                Button {
                                    if let url = task.prUrl.flatMap(URL.init) { openURL(url) }
                                } label: {
                                    row(title: task.title, detail: "\(repoLine(task)) · pull request ready · swipe to merge", icon: "arrow.triangle.pull", color: Theme.celadon)
                                }
                                .tint(.primary)
                                .swipeActions(edge: .leading) { mergeButton(task) }
                                .swipeActions { sessionLink(task) }
                            }
                        } header: { header("Ready for review", review.count) }
                    }
                    if !running.isEmpty || !waiting.isEmpty {
                        Section {
                            ForEach(running) { task in
                                Group {
                                    if let sid = task.sessionId {
                                        NavigationLink(value: sid) { row(title: task.title, detail: "\(repoLine(task)) · running on your Mac", icon: "bolt.fill", color: .blue, pulsing: true) }
                                    } else {
                                        row(title: task.title, detail: "\(repoLine(task)) · starting on your Mac", icon: "bolt.fill", color: .blue, pulsing: true)
                                    }
                                }
                                .swipeActions { cancelButton(task) }
                            }
                            ForEach(waiting) { task in
                                row(title: task.title, detail: "\(repoLine(task)) · \(waitReason)", icon: "clock", color: .gray)
                                    .swipeActions { cancelButton(task) }
                            }
                        } header: { header("Running", running.count + waiting.count, note: concurrency > 0 ? "\(running.count) of \(concurrency) slots" : nil) }
                    }
                    if !finished.isEmpty {
                        Section {
                            ForEach(finished) { task in
                                row(title: task.title, detail: "\(repoLine(task)) · \(finishedLine(task))", icon: task.state == "merged" ? "checkmark" : task.state == "failed" ? "xmark" : "minus", color: task.state == "merged" ? Theme.celadon : task.state == "failed" ? Theme.red : .gray)
                            }
                        } header: { header("Recently finished", finished.count) }
                    }
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red).listRowBackground(Color.clear)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .background(CeliadorBackground())
        .navigationTitle("Queue")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showRepos = true } label: { Image(systemName: "eye") }
                    .accessibilityLabel("Watched repos")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNew = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Start a task")
            }
        }
        .toast($toast)
        .sheet(isPresented: $showNew) { NewTaskSheet { title in toast = "Queued: \(title)"; Task { await load() } } }
        .sheet(isPresented: $showRepos) { WatchedReposSheet(watched: $watched) }
        .task {
            // Poll while the tab is visible; the list is small and the daemon cheap to ask.
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 8_000_000_000)
            }
        }
    }

    private var waitReason: String {
        running.count >= concurrency && concurrency > 0 ? "waiting for a free slot" : "waiting for your Mac to open the repo"
    }

    private func load() async {
        #if DEBUG
        if DemoData.isActive {
            tasks = DemoData.tasks
            concurrency = 2
            watched = ["https://github.com/acme/web.git", "https://github.com/acme/api.git"]
            loaded = true
            return
        }
        #endif
        do {
            let list = try await Api.shared.listTasks()
            tasks = list.tasks
            concurrency = list.concurrency
            watched = list.repos
            error = nil
        } catch {
            self.error = (error as NSError).localizedDescription
        }
        loaded = true
    }

    private func repoLine(_ task: AgentTask) -> String {
        task.issue.map { "\(task.repo.name) #\($0.number)" } ?? task.repo.name
    }

    private func finishedLine(_ task: AgentTask) -> String {
        switch task.state {
        case "merged": return "merged"
        case "failed": return task.error.map { "failed: \($0)" } ?? "failed"
        default: return "cancelled"
        }
    }

    private func header(_ title: String, _ count: Int, note: String? = nil) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(note ?? "\(count)").monospacedDigit()
        }
    }

    private func row(title: String, detail: String, icon: String, color: Color, pulsing: Bool = false) -> some View {
        HStack(spacing: 12) {
            IconBadge(systemName: icon, color: color, pulsing: pulsing)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).lineLimit(2)
                Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func sessionLink(_ task: AgentTask) -> some View {
        if let sid = task.sessionId {
            Button { model.queuePath.append(sid) } label: { Label("Transcript", systemImage: "text.bubble") }.tint(.blue)
        }
    }

    /// "Approve and merge": the editor merges the run's pull request with its
    /// GitHub sign-in and the daemon moves the task to merged.
    @ViewBuilder
    private func mergeButton(_ task: AgentTask) -> some View {
        if let sid = task.sessionId {
            Button {
                Haptics.tap()
                Task {
                    do {
                        let result = try await Api.shared.gitMergePullRequest(sessionId: sid)
                        Haptics.success()
                        toast = result.merged ? "Merged" : "Not merged"
                        await load()
                    } catch {
                        Haptics.error()
                        toast = (error as NSError).localizedDescription
                    }
                }
            } label: { Label("Merge", systemImage: "arrow.triangle.merge") }
            .tint(Theme.celadon)
        }
    }

    private func cancelButton(_ task: AgentTask) -> some View {
        Button(role: .destructive) {
            Task {
                do {
                    try await Api.shared.cancelTask(task.id)
                    toast = "Cancelled"
                    await load()
                } catch {
                    toast = (error as NSError).localizedDescription
                }
            }
        } label: { Label("Cancel", systemImage: "xmark") }
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
                Section("Task") {
                    TextField("What should change?", text: $title, axis: .vertical).lineLimit(1...3)
                    TextField("Details (optional)", text: $details, axis: .vertical).lineLimit(3...8)
                }
                Section {
                    Text("Runs on your Mac in its own worktree and branch, and ends in a pull request.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.red) }
            }
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
                        .tint(Theme.celadon)
                    }
                } footer: {
                    Text("Label an issue `celiador`, or comment `@celiador` as a collaborator, and the agent picks it up. Needs the repo's Celiador webhook.")
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.red) }
            }
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
