import SwiftUI
import UIKit

/// The list of agent sessions. Editor-started runs show up here to watch and
/// steer; tapping one opens its live transcript.
struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var actionError: String?
    @State private var toast: String?
    @State private var query = ""
    @State private var showNewRun = false
    @State private var didLoad = false

    private func match(_ items: [Session]) -> [Session] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let filtered = q.isEmpty ? items : items.filter { $0.title.localizedCaseInsensitiveContains(q) }
        return filtered.sorted { $0.updatedAt > $1.updatedAt } // ISO8601 sorts lexically
    }

    // Only sessions actually blocked on a decision belong in "Needs you"; a failed
    // run is history (nothing to act on from the phone), so it lands in Recent.
    private var needsYou: [Session] { match(model.sessions.filter { $0.state == .awaiting }) }
    private var working: [Session] { match(model.sessions.filter { $0.state == .running }) }
    private var recent: [Session] { match(model.sessions.filter { !$0.state.isActive }) }

    private var isEmpty: Bool { model.sessions.isEmpty }
    private var noMatches: Bool { !isEmpty && needsYou.isEmpty && working.isEmpty && recent.isEmpty }

    var body: some View {
        content
        .background(CeliadorBackground())
        .navigationTitle("Runs")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { Haptics.tap(); model.selectedTab = .settings } label: { Image(systemName: "person.circle") }
                    .accessibilityLabel("Settings")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { Haptics.tap(); showNewRun = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New Cloud Run")
            }
        }
        .toast($toast)
        .sheet(isPresented: $showNewRun) { NewRunView().trackScreen(.newRun) }
        .task {
            await model.refresh()
            withAnimation(Theme.gentle) { didLoad = true }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !didLoad && isEmpty {
            skeleton
        } else if isEmpty {
            EmptyStateView(
                icon: "sparkles",
                title: "No runs yet",
                message: "Kick off a task in the Celiador editor, or start one in the cloud. It shows up here so you can watch it work and approve changes from your phone.",
                actionTitle: "Start a cloud run",
                action: { showNewRun = true }
            )
        } else {
            list
        }
    }

    private var workingCount: Int { model.sessions.filter { $0.state == .running }.count }

    private var list: some View {
        List {
            if workingCount > 0 || model.needsYouCount > 0 {
                HStack(spacing: 8) {
                    if workingCount > 0 {
                        StatusPill(text: "\(workingCount) working", color: Theme.accentBright, icon: "bolt.fill")
                    }
                    if model.needsYouCount > 0 {
                        StatusPill(text: "\(model.needsYouCount) need you", color: Theme.attention, icon: "hand.raised.fill")
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 4, trailing: 8))
            }

            if let actionError {
                Text(actionError)
                    .font(.footnote).foregroundStyle(Theme.red)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }

            section("Needs you", needsYou, accent: Theme.attention)
            section("Working", working, accent: Theme.accentBright)
            section("Recent", recent, accent: Theme.dim)

            if noMatches {
                Text("No sessions match “\(query)”.")
                    .font(.footnote).foregroundStyle(Theme.dim)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .brandGround()
        .animation(Theme.spring, value: model.sessions.map(\.id))
        .refreshable { await model.refresh() }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search runs")
    }

    private var skeleton: some View {
        List {
            Section {
                ForEach(0..<4, id: \.self) { _ in
                    SkeletonRow()
                }
                .listRowBackground(Theme.panel)
            } header: {
                SkeletonBar(width: 90, height: 10)
            }
        }
        .listStyle(.insetGrouped)
        .brandGround()
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [Session], accent: Color) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { session in
                    NavigationLink(value: session.id) {
                        SessionRow(session: session, liveLine: model.activity[session.id])
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) { delete(session) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
                .listRowBackground(Theme.panel)
            } header: {
                HStack {
                    Text(title)
                    Spacer()
                    Text("\(items.count)").monospacedDigit()
                }
            }
        }
    }

    private func delete(_ session: Session) {
        actionError = nil
        Haptics.warning()
        Task {
            do {
                try await Api.shared.deleteSession(session.id)
                Telemetry.signal(.sessionDeleted)
                await model.refresh()
                toast = "Run deleted"
            } catch {
                Telemetry.error(.sessions, "delete", error)
                actionError = error.localizedDescription
                Haptics.error()
            }
        }
    }
}

struct SessionRow: View {
    let session: Session
    var liveLine: String?

    private var badge: (icon: String, color: Color) {
        switch session.state {
        case .running: return ("bolt.fill", Theme.accent)
        case .awaiting: return ("hand.raised.fill", Theme.attention)
        case .error: return ("xmark", Theme.red)
        case .done: return ("checkmark", Theme.added)
        default: return ("minus", .gray)
        }
    }

    private var subtitle: String {
        if session.state.isActive, let liveLine, !liveLine.isEmpty { return liveLine }
        // A cloud session: where it works (its worktree branch).
        if let repo = session.repo { return "\(session.state.label) · \(repo.branch)" }
        return session.state.label
    }

    private var subtitleColor: Color {
        session.state == .awaiting ? Theme.attention : Theme.dim
    }

    /// Only editor runs have an editor to lose; a cloud run's runner is the daemon.
    private var editorOffline: Bool { !session.isCloud && !session.runnerConnected && session.state.isActive }

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: badge.icon, color: badge.color, pulsing: session.state == .running)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(session.title)
                        .font(.body)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(RelativeTime.short(session.updatedAt))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(subtitleColor)
                    .lineLimit(1)
                    .truncationMode(.middle)

                if session.state == .awaiting || session.state == .error || editorOffline {
                    HStack(spacing: 6) {
                        if session.state == .awaiting {
                            StatusPill(text: "needs you", color: Theme.attention, icon: "hand.raised.fill")
                        } else if session.state == .error {
                            StatusPill(text: "failed", color: Theme.red, icon: "exclamationmark.triangle.fill")
                        }
                        if editorOffline {
                            StatusPill(text: "editor offline", color: Theme.dim, icon: "bolt.slash.fill")
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// Start a server-side (cloud) run from the phone — the daemon clones a repo and runs
/// the agent itself, no desktop needed. On success it navigates straight into the run.
struct NewRunView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var repoURL = ""
    @State private var branch = ""
    @State private var prompt = ""
    @State private var starting = false
    @State private var error: String?
    @State private var recents = RepoRecents.list()
    @State private var editorWorkspaces: [EditorWorkspace] = []
    /// Your repos (linked in the queue) — with the GitHub App, private ones work and runs can push.
    @State private var cloudRepos: [CloudRepo] = []
    /// The picked repo's branches (App repos only); empty → free-text branch field.
    @State private var branches: [String] = []
    @State private var loadingBranches = false
    /// Work directly on `branch` instead of a new `celiador/…` branch off it.
    @State private var workOnBranch = false
    // Compose mode: tapping an editor repo opens a chat composer for it. The first
    // message you send creates the run on your Mac and drops you into the live chat.
    @State private var composing: EditorWorkspace?
    @State private var firstMessage = ""
    @State private var sending = false
    @FocusState private var composerFocused: Bool

    /// `composing` opens straight into the composer for that editor repo (screenshots).
    init(composing: EditorWorkspace? = nil) {
        _composing = State(initialValue: composing)
    }

    /// Cloud runs execute unattended, so the form needs a repo URL and a task.
    private var canStart: Bool {
        let validRepo = repoURL.hasPrefix("http://") || repoURL.hasPrefix("https://")
        let hasPrompt = !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasBranch = !workOnBranch || !trimmedBranch.isEmpty
        return validRepo && hasPrompt && hasBranch
    }

    private var trimmedBranch: String { branch.trimmingCharacters(in: .whitespaces) }

    /// The linked repo the URL field points at, if any (case-insensitive, `.git` optional).
    private var pickedCloudRepo: CloudRepo? {
        let norm = { (u: String) -> String in
            let t = u.trimmingCharacters(in: .whitespaces).lowercased()
            return t.hasSuffix(".git") ? String(t.dropLast(4)) : t
        }
        return cloudRepos.first { norm($0.url) == norm(repoURL) }
    }

    /// Load the picked repo's branches (App repos), defaulting to its default branch.
    private func loadBranches() async {
        guard let repo = pickedCloudRepo, repo.app else { branches = []; return }
        loadingBranches = true
        let list = (try? await Api.shared.cloudBranches(remoteUrl: repo.url)) ?? []
        loadingBranches = false
        guard pickedCloudRepo?.url == repo.url else { return } // the pick changed meanwhile
        branches = list
        if !list.contains(trimmedBranch) { branch = repo.defaultBranch ?? list.first ?? "" }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let ws = composing {
                    composeView(ws)
                } else {
                    formView
                }
            }
            .navigationTitle(composing?.name ?? "New run")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: repoURL) { await loadBranches() }
            .task {
                #if DEBUG
                if DemoData.isActive {
                    editorWorkspaces = DemoData.editorWorkspaces
                    if recents.isEmpty { recents = DemoData.repoRecents }
                    return
                }
                #endif
                async let repos = Api.shared.cloudRepos()
                editorWorkspaces = (try? await Api.shared.editorWorkspaces()) ?? []
                cloudRepos = (try? await repos) ?? []
                await loadBranches()
                Telemetry.signal(.newRunOpened, ["editorRepos": Telemetry.bucket(editorWorkspaces.count)])
                if !editorWorkspaces.isEmpty { Telemetry.onboarding(.editorPaired) }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if composing != nil {
                        Button { composing = nil; firstMessage = ""; error = nil } label: {
                            Image(systemName: "chevron.left")
                        }
                        .accessibilityLabel("Back")
                    } else {
                        Button("Cancel") { dismiss() }
                    }
                }
                if composing == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if starting {
                            ProgressView()
                        } else {
                            Button("Start") { Task { await start() } }
                                .fontWeight(.semibold)
                                .disabled(!canStart)
                        }
                    }
                }
            }
        }
    }

    /// One tappable row in the sheet: a Settings-style badge, a title and a
    /// secondary line, like the run rows on the Runs and Queue tabs.
    private func optionRow(icon: String, color: Color, title: String, subtitle: String?, trailing: String? = nil) -> some View {
        HStack(spacing: 12) {
            IconBadge(systemName: icon, color: color)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Theme.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 4)
            if let trailing {
                Image(systemName: trailing)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(trailing == "checkmark" ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(.tertiary))
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private var formView: some View {
        Form {
            if !editorWorkspaces.isEmpty {
                Section {
                    ForEach(editorWorkspaces) { ws in
                        Button {
                            Haptics.tap()
                            composing = ws
                        } label: {
                            optionRow(icon: "laptopcomputer", color: Theme.accent, title: ws.name,
                                      subtitle: RepoRecents.shortLabel(ws.remoteUrl), trailing: "chevron.right")
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("On your Mac")
                } footer: {
                    Text("Opens a chat with the editor. Runs on your local copy, no clone.")
                }
                .listRowBackground(Theme.panel)
            }

            if !cloudRepos.isEmpty {
                Section {
                    ForEach(cloudRepos) { repo in
                        Button {
                            Haptics.tap()
                            repoURL = repo.url
                        } label: {
                            optionRow(icon: repo.private == true ? "lock.fill" : "shippingbox.fill", color: Theme.accent,
                                      title: repo.label,
                                      subtitle: repo.app ? nil : "No GitHub App — public only, no push",
                                      trailing: pickedCloudRepo?.url == repo.url ? "checkmark" : nil)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text(editorWorkspaces.isEmpty ? "Your repos" : "Or run in the cloud")
                }
                .listRowBackground(Theme.panel)
            }

            Section {
                // Verbatim: a string-literal placeholder is markdown, and the URL would render as a link.
                TextField("Repository URL", text: $repoURL, prompt: Text(verbatim: "https://github.com/owner/repo.git"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                PasteButton(payloadType: String.self) { strings in
                    guard let pasted = strings.first?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !pasted.isEmpty else { return }
                    Task { @MainActor in repoURL = pasted; Haptics.tap() }
                }
                .labelStyle(.titleAndIcon)
                .buttonBorderShape(.capsule)
                .tint(Theme.accent)
            } header: {
                Text(!cloudRepos.isEmpty ? "Any repo" : editorWorkspaces.isEmpty ? "Run in the cloud" : "Or run in the cloud")
            }
            .listRowBackground(Theme.panel)

            Section {
                if branches.isEmpty {
                    HStack {
                        TextField(workOnBranch ? "Branch" : "Start from (default branch)", text: $branch)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if loadingBranches { ProgressView() }
                    }
                } else {
                    Picker(workOnBranch ? "Branch" : "Start from", selection: $branch) {
                        ForEach(branches, id: \.self) { Text($0).tag($0) }
                    }
                }
                Toggle("Work directly on this branch", isOn: $workOnBranch)
            } header: {
                Text("Branch")
            } footer: {
                Text(workOnBranch
                     ? "The agent continues \(trimmedBranch.isEmpty ? "the branch" : "“\(trimmedBranch)”") in its own worktree; pushing adds its commits to that branch."
                     : "The agent works in its own git worktree on a new celiador/… branch off \(trimmedBranch.isEmpty ? "the default branch" : "“\(trimmedBranch)”"), ready for a pull request.")
            }
            .listRowBackground(Theme.panel)

            if !recents.isEmpty {
                Section("Recent repos") {
                    ForEach(recents, id: \.self) { url in
                        Button {
                            repoURL = url
                            Haptics.select()
                        } label: {
                            optionRow(icon: "clock.arrow.circlepath", color: .gray, title: RepoRecents.shortLabel(url),
                                      subtitle: nil,
                                      trailing: url == repoURL.trimmingCharacters(in: .whitespaces) ? "checkmark" : nil)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in
                        for i in offsets { RepoRecents.forget(recents[i]) }
                        recents = RepoRecents.list()
                    }
                }
                .listRowBackground(Theme.panel)
            }

            Section {
                TextField("What should the agent do?", text: $prompt, axis: .vertical)
                    .lineLimit(3...8)
            } header: {
                Text("Task")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.red)
                    }
                    Text("Runs on Celiador's servers, no computer needed. You watch it here, send follow-ups, review the diff, then push and open the pull request from the phone. Private repos, push and pull requests need the repo in your repos with the Celiador GitHub App installed.")
                }
            }
            .listRowBackground(Theme.panel)
        }
        .brandGround()
    }

    /// A chat-style first-message composer for a repo open in the editor. Sending the
    /// message starts a local run on the Mac and navigates into the live session.
    private func composeView(_ ws: EditorWorkspace) -> some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Image(systemName: "laptopcomputer")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(.bottom, 4)
                Text("Chat with \(ws.name)")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                StatusPill(text: "Runs on your Mac", color: Theme.accent, icon: "laptopcomputer")
                Text(RepoRecents.shortLabel(ws.remoteUrl))
                    .font(.subheadline).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.middle)
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote).foregroundStyle(Theme.red)
                        .multilineTextAlignment(.center).padding(.top, 4)
                }
            }
            .padding(.horizontal, 32)
            Spacer()
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Message…", text: $firstMessage, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($composerFocused)
                    .onSubmit { Task { await sendFirst(ws) } }
                if sending {
                    ProgressView().frame(width: 34, height: 34)
                } else {
                    SendButton(enabled: !firstMessage.trimmingCharacters(in: .whitespaces).isEmpty) {
                        Task { await sendFirst(ws) }
                    }
                }
            }
            .padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 6)
            .glassCapsule()
            .padding(12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CeliadorBackground())
        .trackScreen(.newRunCompose)
        .onAppear { composerFocused = true }
    }

    /// Send the first message → create the local run on the Mac → jump into the chat.
    private func sendFirst(_ ws: EditorWorkspace) async {
        let msg = firstMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty, !sending else { return }
        sending = true
        error = nil
        Haptics.tap()
        do {
            let before = Set((try? await Api.shared.listSessions())?.map(\.id) ?? [])
            try await Api.shared.requestEditorRun(remoteUrl: ws.remoteUrl, name: ws.name, branch: ws.branch, prompt: msg)
            Telemetry.signal(.phoneRun, ["seeded": "true"])
            RepoRecents.remember(ws.remoteUrl)
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                let now = (try? await Api.shared.listSessions()) ?? []
                if let fresh = now.first(where: { !before.contains($0.id) }) {
                    await model.refresh()
                    dismiss()
                    model.open(sessionId: fresh.id)
                    sending = false
                    return
                }
            }
            Telemetry.error(.run, "editorRun", code: "editorTimeout")
            error = "Couldn't reach your editor. Make sure Celiador is open and signed in on your Mac."
        } catch {
            Telemetry.error(.run, "editorRun", error)
            self.error = (error as NSError).localizedDescription
        }
        sending = false
    }

    /// Start a cloud run (unattended, on Celiador's servers) from the form.
    private func start() async {
        starting = true
        error = nil
        do {
            let repo = repoURL.trimmingCharacters(in: .whitespaces)
            let br = trimmedBranch.isEmpty ? nil : trimmedBranch
            let session = try await Api.shared.startServerRun(repoURL: repo, branch: br, existingBranch: workOnBranch, prompt: prompt)
            Telemetry.signal(.cloudRunStarted, ["branch": workOnBranch ? "existing" : "new", "app": pickedCloudRepo?.app == true ? "true" : "false"])
            RepoRecents.remember(repo)
            await model.refresh()
            dismiss()
            model.open(sessionId: session.id)
        } catch {
            Telemetry.error(.run, "cloudRun", error)
            self.error = (error as NSError).localizedDescription
        }
        starting = false
    }
}
