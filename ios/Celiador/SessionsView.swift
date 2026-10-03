import SwiftUI

/// The list of agent sessions. Editor-started runs show up here to watch and
/// steer; tapping one opens its live transcript.
struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var actionError: String?
    @State private var showAccount = false
    @State private var showHistory = false
    @State private var showNewRun = false

    private var needsYou: [Session] { sorted(model.sessions.filter { $0.state == .awaiting || $0.state == .error }) }
    private var working: [Session] { sorted(model.sessions.filter { $0.state == .running }) }
    private var recent: [Session] { sorted(model.sessions.filter { !$0.state.isActive && $0.state != .error }) }

    private func sorted(_ items: [Session]) -> [Session] {
        items.sorted { $0.updatedAt > $1.updatedAt } // ISO8601 sorts lexically
    }

    var body: some View {
        List {
            if let actionError {
                Text(actionError)
                    .font(.footnote)
                    .foregroundStyle(Theme.red)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            section("Needs you", needsYou, accent: Theme.attention)
            section("Working", working, accent: Theme.celadonBright)
            section("Recent", recent, accent: Theme.dim)

            if model.sessions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No sessions yet.")
                        .foregroundStyle(Theme.ink)
                    Text("Start a task in the Celiador editor, or tap + to run one in the cloud. It'll appear here so you can watch it work and approve changes from your phone.")
                        .font(.footnote)
                        .foregroundStyle(Theme.dim)
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .refreshable { await model.refresh() }
        .navigationTitle("Celiador")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showAccount = true } label: { Image(systemName: "person.circle") }
                    .accessibilityLabel("Account")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNewRun = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New Cloud Run")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showHistory = true } label: { Image(systemName: "clock.arrow.circlepath") }
                    .accessibilityLabel("History")
            }
        }
        .sheet(isPresented: $showAccount) { AccountView() }
        .sheet(isPresented: $showHistory) { HistoryView() }
        .sheet(isPresented: $showNewRun) { NewRunView() }
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
                HStack {
                    Text(title.uppercased())
                        .font(.caption2.weight(.bold))
                        .kerning(1)
                        .foregroundStyle(accent)
                    Spacer()
                    Text("\(items.count)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.dim)
                }
            }
        }
    }

    private func delete(_ session: Session) {
        actionError = nil
        Task {
            do {
                try await Api.shared.deleteSession(session.id)
                await model.refresh()
            } catch {
                actionError = error.localizedDescription
            }
        }
    }
}

struct SessionRow: View {
    let session: Session
    var liveLine: String?

    private var dotColor: Color {
        switch session.state {
        case .running: return Theme.celadon
        case .awaiting: return Theme.attention
        case .error: return Theme.red
        default: return Theme.border
        }
    }

    private var subtitle: String {
        if session.state.isActive, let liveLine, !liveLine.isEmpty { return liveLine }
        return session.state.label
    }

    private var subtitleColor: Color {
        session.state == .awaiting ? Theme.attention : Theme.dim
    }

    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(subtitleColor)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            if session.state == .running {
                ProgressView().controlSize(.mini)
            } else if !session.runnerConnected, session.state.isActive {
                Image(systemName: "bolt.slash").font(.caption2).foregroundStyle(Theme.dim)
            }
        }
        .padding(.vertical, 4)
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
            let session = try await Api.shared.startServerRun(
                repoURL: repoURL.trimmingCharacters(in: .whitespaces),
                branch: branch.trimmingCharacters(in: .whitespaces).isEmpty ? nil : branch.trimmingCharacters(in: .whitespaces),
                prompt: prompt
            )
            await model.refresh()
            dismiss()
            model.open(sessionId: session.id)
        } catch {
            self.error = (error as NSError).localizedDescription
        }
        starting = false
    }
}
