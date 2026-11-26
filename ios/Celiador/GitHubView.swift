import SafariServices
import SwiftUI

/// Connect GitHub and add your repos — from the phone, no computer needed.
///
/// The daemon owns the flow (github/access.ts): `POST /api/github/account/connect`
/// hands out one-time github.com links; the browser comes back to the daemon's
/// callback, which asks "connect @login to <your account>?" and stores the
/// connection. This screen only opens the link in an in-app browser and reloads
/// when it closes. Adding a repo is `POST /api/tasks/repos`, which re-checks on
/// GitHub that you can write to it. A repo added here can run in the cloud.
struct GitHubView: View {
    @State private var account: GitHubAccount?
    @State private var repos: [GitHubRepo] = []
    @State private var loading = true
    @State private var error: String?
    @State private var browser: BrowserLink?
    @State private var busy: Set<String> = []
    @State private var confirmDisconnect = false

    var body: some View {
        Form {
            if loading && account == nil {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else if let account, !account.app {
                Section {
                    Text("GitHub isn't set up on this server yet.").foregroundStyle(.secondary)
                }
                .listRowBackground(Theme.panel)
            } else if let account, !account.connected {
                connectSection
            } else if let account {
                reposSection(login: account.login)
                Section {
                    Button("Add repos on GitHub") { open(\.installUrl) }
                } footer: {
                    Text("Only repos the Celiador GitHub App is installed on are listed. Install it on more, then come back.")
                }
                .listRowBackground(Theme.panel)
                Section {
                    Button("Disconnect GitHub", role: .destructive) { confirmDisconnect = true }
                }
                .listRowBackground(Theme.panel)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(Theme.red).listRowBackground(Color.clear)
            }
        }
        .brandGround()
        .navigationTitle("GitHub")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $browser, onDismiss: { Task { await load() } }) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .confirmationDialog("Disconnect GitHub?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await disconnect() } }
        } message: {
            Text("Cloud runs stop working on your repos until you connect again. Your repos stay on your list.")
        }
    }

    private var connectSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Label("Connect GitHub", systemImage: "link").font(.headline)
                Text("Pick the repos the agent may work on. It works on its own branch and opens a pull request; nothing is merged without you.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
            Button {
                Haptics.tap(); open(\.installUrl)
            } label: {
                Label("Install the Celiador GitHub App", systemImage: "plus.app")
            }
            Button {
                Haptics.tap(); open(\.authorizeUrl)
            } label: {
                Label("Already installed? Connect your account", systemImage: "person.badge.key")
            }
        } footer: {
            Text("Opens github.com. Installing lets you choose which repos Celiador can see; it also connects your account.")
        }
        .listRowBackground(Theme.panel)
    }

    @ViewBuilder
    private func reposSection(login: String?) -> some View {
        Section {
            if repos.isEmpty {
                Text("No repos yet. Install the Celiador GitHub App on the repos you want, then pull to refresh.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(repos) { repo in
                HStack {
                    Image(systemName: repo.private ? "lock.fill" : "shippingbox.fill")
                        .foregroundStyle(Theme.accent)
                        .frame(width: 22)
                    Text(repo.label).lineLimit(1)
                    Spacer()
                    if busy.contains(repo.url) {
                        ProgressView()
                    } else if repo.linked {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ready)
                            .accessibilityLabel("Added")
                    } else {
                        Button("Add") { Task { await add(repo) } }
                            .buttonStyle(.borderless)
                            .font(.subheadline.weight(.medium))
                    }
                }
            }
        } header: {
            Text(login.map { "Connected as @\($0)" } ?? "Connected")
        } footer: {
            Text("Added repos show up when you start a task, run in the cloud when no computer has them open, and turn issues labelled `celiador` into tasks.")
        }
        .listRowBackground(Theme.panel)
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let acct = try await Api.shared.githubAccount()
            account = acct
            repos = acct.connected ? try await Api.shared.githubRepos() : []
            error = nil
        } catch let e as Api.ApiError where e.status == 409 {
            // The connection expired or was revoked on GitHub: offer to connect again.
            account = GitHubAccount(app: true, connected: false)
            repos = []
            error = nil
        } catch {
            Telemetry.error(.github, "load", error)
            self.error = (error as NSError).localizedDescription
        }
    }

    private func open(_ which: KeyPath<GitHubConnectLinks, String>) {
        Task {
            do {
                let links = try await Api.shared.githubConnectLinks()
                if let url = URL(string: links[keyPath: which]) { browser = BrowserLink(url: url) }
            } catch {
                Telemetry.error(.github, "connect", error)
                self.error = (error as NSError).localizedDescription
            }
        }
    }

    private func add(_ repo: GitHubRepo) async {
        busy.insert(repo.url)
        defer { busy.remove(repo.url) }
        do {
            try await Api.shared.setRepoWatched(repo.url, watched: true)
            Telemetry.signal(.repoWatchToggled, ["watched": "true"])
            Haptics.success()
            if let i = repos.firstIndex(where: { $0.url == repo.url }) { repos[i].linked = true }
            error = nil
        } catch {
            Telemetry.error(.github, "add", error)
            Haptics.error()
            self.error = (error as NSError).localizedDescription
        }
    }

    private func disconnect() async {
        do {
            try await Api.shared.disconnectGitHub()
            Haptics.warning()
            await load()
        } catch {
            self.error = (error as NSError).localizedDescription
        }
    }
}

/// `GitHubView` as a sheet over another sheet (New task, Watched repos), with a Done button.
struct GitHubSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            GitHubView()
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .trackScreen(.github)
    }
}

private struct BrowserLink: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// An in-app browser: the GitHub round trip ends on the daemon's own page, so the
/// user just closes it and the screen reloads.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
