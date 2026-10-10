import SwiftUI
import UIKit

/// The list of agent sessions. Editor-started runs show up here to watch and
/// steer; tapping one opens its live transcript.
struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var actionError: String?
    @State private var toast: String?
    @State private var query = ""
    @State private var showAccount = false
    @State private var showNewRun = false
    @State private var didLoad = false

    private func match(_ items: [Session]) -> [Session] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let filtered = q.isEmpty ? items : items.filter { $0.title.localizedCaseInsensitiveContains(q) }
        return filtered.sorted { $0.updatedAt > $1.updatedAt } // ISO8601 sorts lexically
    }

    private var needsYou: [Session] { match(model.sessions.filter { $0.state == .awaiting || $0.state == .error }) }
    private var working: [Session] { match(model.sessions.filter { $0.state == .running }) }
    private var recent: [Session] { match(model.sessions.filter { !$0.state.isActive && $0.state != .error }) }

    private var isEmpty: Bool { model.sessions.isEmpty }
    private var noMatches: Bool { !isEmpty && needsYou.isEmpty && working.isEmpty && recent.isEmpty }

    var body: some View {
        ZStack {
            CeliadorBackground()
            content
        }
        .toolbar {
            ToolbarItem(placement: .principal) { Wordmark(size: 19, glow: false) }
            ToolbarItem(placement: .topBarLeading) {
                Button { Haptics.tap(); showAccount = true } label: { Image(systemName: "person.circle") }
                    .accessibilityLabel("Account")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { Haptics.tap(); showNewRun = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New Cloud Run")
            }
        }
        .toast($toast)
        .sheet(isPresented: $showAccount) { AccountView() }
        .sheet(isPresented: $showNewRun) { NewRunView() }
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
                        StatusPill(text: "\(workingCount) working", color: Theme.celadonBright, icon: "bolt.fill")
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
            section("Working", working, accent: Theme.celadonBright)
            section("Recent", recent, accent: Theme.dim)

            if noMatches {
                Text("No sessions match “\(query)”.")
                    .font(.footnote).foregroundStyle(Theme.dim)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .animation(Theme.spring, value: model.sessions.map(\.id))
        .refreshable { await model.refresh() }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search runs")
    }

    private var skeleton: some View {
        List {
            Section {
                ForEach(0..<4, id: \.self) { _ in
                    SkeletonRow().listRowBackground(Theme.panel)
                }
            } header: {
                SkeletonBar(width: 90, height: 10)
            }
        }
        .listStyle(.insetGrouped)
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
                    .listRowBackground(Theme.panel)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) { delete(session) } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            } header: {
                HStack(spacing: 8) {
                    Circle().fill(accent).frame(width: 6, height: 6)
                    Text(title.uppercased())
                        .font(.caption2.weight(.bold)).kerning(1)
                        .foregroundStyle(accent)
                    Spacer()
                    Text("\(items.count)")
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(Theme.dim)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Theme.panelHi, in: Capsule())
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
                await model.refresh()
                toast = "Run deleted"
            } catch {
                actionError = error.localizedDescription
                Haptics.error()
            }
        }
    }
}

struct SessionRow: View {
    let session: Session
    var liveLine: String?

    private var dotColor: Color {
        switch session.state {
        case .running: return Theme.celadonBright
        case .awaiting: return Theme.attention
        case .error: return Theme.red
        default: return Theme.faint
        }
    }

    private var subtitle: String {
        if session.state.isActive, let liveLine, !liveLine.isEmpty { return liveLine }
        return session.state.label
    }

    private var subtitleColor: Color {
        session.state == .awaiting ? Theme.attention : Theme.dim
    }

    private var editorOffline: Bool { !session.runnerConnected && session.state.isActive }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            StatusDot(color: dotColor, pulsing: session.state == .running, size: 10)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(session.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(RelativeTime.short(session.updatedAt))
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.faint)
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(subtitleColor)
                    .lineLimit(1)
                    .truncationMode(.middle)

                if session.state == .awaiting || session.state == .error || editorOffline {
                    HStack(spacing: 6) {
                        if session.state == .awaiting {
                            StatusPill(text: "needs you", color: Theme.attention, icon: "hand.raised.fill")
                        } else if session.state == .error {
                            StatusPill(text: "error", color: Theme.red, icon: "exclamationmark.triangle.fill")
                        }
                        if editorOffline {
                            StatusPill(text: "editor offline", color: Theme.dim, icon: "bolt.slash.fill")
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 5)
    }
}

/// Start a server-side (cloud) run from the phone — the daemon clones a repo and runs
/// the agent itself, no desktop needed. On success it navigates straight into the run.
private struct NewRunView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var repoURL = ""
    @State private var branch = ""
    @State private var prompt = ""
    @State private var starting = false
    @State private var error: String?
    @State private var recents = RepoRecents.list()
    @State private var editorWorkspaces: [EditorWorkspace] = []

    private var canStart: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (repoURL.hasPrefix("http://") || repoURL.hasPrefix("https://"))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Repository") {
                    TextField("https://github.com/owner/repo.git", text: $repoURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Branch (optional)", text: $branch)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        if let pasted = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines),
                           !pasted.isEmpty {
                            repoURL = pasted
                            Haptics.tap()
                        }
                    } label: {
                        Label("Paste repo URL", systemImage: "doc.on.clipboard")
                    }
                    .disabled(!UIPasteboard.general.hasStrings)
                }
                if !editorWorkspaces.isEmpty {
                    Section("From your editor") {
                        ForEach(editorWorkspaces) { ws in
                            Button {
                                repoURL = ws.remoteUrl
                                if let b = ws.branch, !b.isEmpty { branch = b }
                                Haptics.tap()
                            } label: {
                                HStack {
                                    Image(systemName: "laptopcomputer")
                                        .foregroundStyle(Theme.dim)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(ws.name)
                                            .foregroundStyle(Theme.ink)
                                            .lineLimit(1)
                                        Text(RepoRecents.shortLabel(ws.remoteUrl))
                                            .font(.caption)
                                            .foregroundStyle(Theme.dim)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                    Spacer()
                                    if ws.remoteUrl == repoURL.trimmingCharacters(in: .whitespaces) {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Theme.celadonBright)
                                    }
                                }
                            }
                        }
                    }
                }
                if !recents.isEmpty {
                    Section("Recent") {
                        ForEach(recents, id: \.self) { url in
                            Button {
                                repoURL = url
                                Haptics.tap()
                            } label: {
                                HStack {
                                    Image(systemName: "clock.arrow.circlepath")
                                        .foregroundStyle(Theme.dim)
                                    Text(RepoRecents.shortLabel(url))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                        .foregroundStyle(Theme.ink)
                                    Spacer()
                                    if url == repoURL.trimmingCharacters(in: .whitespaces) {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Theme.celadonBright)
                                    }
                                }
                            }
                        }
                        .onDelete { offsets in
                            for i in offsets { RepoRecents.forget(recents[i]) }
                            recents = RepoRecents.list()
                        }
                    }
                }
                Section("Task") {
                    TextField("What should the agent do?", text: $prompt, axis: .vertical)
                        .lineLimit(3...8)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.red)
                }
                Section {
                    Text("Runs on Celiador's servers — no desktop needed. You'll watch it here and get a diff back.")
                        .font(.footnote).foregroundStyle(Theme.dim)
                }
            }
            .navigationTitle("New Cloud Run")
            .navigationBarTitleDisplayMode(.inline)
            .task { editorWorkspaces = (try? await Api.shared.editorWorkspaces()) ?? [] }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if starting {
                        ProgressView()
                    } else {
                        Button("Start") { Task { await start() } }
                            .disabled(!canStart)
                    }
                }
            }
        }
    }

    private func start() async {
        starting = true
        error = nil
        do {
            let repo = repoURL.trimmingCharacters(in: .whitespaces)
            let session = try await Api.shared.startServerRun(
                repoURL: repo,
                branch: branch.trimmingCharacters(in: .whitespaces).isEmpty ? nil : branch.trimmingCharacters(in: .whitespaces),
                prompt: prompt
            )
            RepoRecents.remember(repo)
            await model.refresh()
            dismiss()
            model.open(sessionId: session.id)
        } catch {
            self.error = (error as NSError).localizedDescription
        }
        starting = false
    }
}
