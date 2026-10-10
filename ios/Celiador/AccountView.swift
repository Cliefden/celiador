import SwiftUI

/// Account screen: the signed-in profile (from the daemon's /api/profile), edit the
/// display name, and sign out. Presented as a sheet from the sessions list.
struct AccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var profile: Profile?
    @State private var me: Me?
    @State private var name = ""
    @State private var error: String?
    @State private var saving = false
    @State private var confirmingDelete = false
    @State private var deleting = false

    private var initials: String {
        let source = (profile?.displayName?.isEmpty == false ? profile?.displayName : profile?.email) ?? "?"
        let parts = source.split(whereSeparator: { $0 == " " || $0 == "@" || $0 == "." })
        let letters = parts.prefix(2).compactMap { $0.first }
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let profile {
                        VStack(spacing: 10) {
                            ZStack {
                                Circle().fill(Theme.accentGradient).frame(width: 64, height: 64)
                                    .shadow(color: Theme.celadon.opacity(0.4), radius: 10, y: 4)
                                Text(initials)
                                    .font(.title2.weight(.bold))
                                    .foregroundStyle(Color(red: 0.04, green: 0.09, blue: 0.07))
                            }
                            Text(profile.displayName?.isEmpty == false ? profile.displayName! : (profile.email ?? "Your account"))
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                            if let email = profile.email {
                                Text(email).font(.caption).foregroundStyle(Theme.dim)
                            }
                            StatusPill(text: "\(profile.plan) plan", color: Theme.celadonBright, icon: "sparkles")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .listRowBackground(Color.clear)
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                            .listRowBackground(Theme.panel)
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowBackground(Color.clear)
                    }
                }

                if profile != nil {
                    Section {
                        HStack {
                            Text("Display name").foregroundStyle(Theme.ink)
                            Spacer()
                            TextField("Your name", text: $name)
                                .multilineTextAlignment(.trailing)
                                .foregroundStyle(Theme.dim)
                                .submitLabel(.done)
                                .onSubmit(save)
                        }
                    } header: {
                        Text("Profile")
                    }
                    .listRowBackground(Theme.panel)
                }

                if let me {
                    Section {
                        UsageMeter(label: "Requests", used: me.usage.requests, limit: me.limits.dailyRequests)
                        UsageMeter(label: "Input tokens", used: me.usage.inputTokens, limit: me.limits.dailyInput)
                        UsageMeter(label: "Output tokens", used: me.usage.outputTokens, limit: me.limits.dailyOutput)
                    } header: {
                        Text("Today's usage")
                    } footer: {
                        Text(resetsFooter)
                    }
                    .listRowBackground(Theme.panel)
                }

                Section {
                    Label {
                        Text("Your code stays on your machine. Agents run locally; the daemon only relays what you send and never trains on your code.")
                            .font(.footnote).foregroundStyle(Theme.dim)
                    } icon: {
                        Image(systemName: "lock.shield").foregroundStyle(Theme.celadonBright)
                    }
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button {
                        Haptics.warning(); model.signOut(); dismiss()
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundStyle(Theme.ink)
                    }
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button(role: .destructive) {
                        Haptics.warning(); confirmingDelete = true
                    } label: {
                        if deleting {
                            HStack { ProgressView(); Text("Deleting account…") }
                        } else {
                            Label("Delete account", systemImage: "trash")
                        }
                    }
                    .disabled(deleting)
                    if let error, profile != nil {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                    }
                } footer: {
                    Text("Permanently deletes your Celiador account, profile, chat history and push registrations. This can't be undone.")
                }
                .listRowBackground(Theme.panel)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(CeliadorBackground())
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if saving {
                        ProgressView()
                    } else if profile != nil {
                        Button("Save", action: save)
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == profile?.displayName)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
            .confirmationDialog(
                "Delete your Celiador account?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete account", role: .destructive, action: deleteAccount)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your account, profile and chat history are permanently deleted. This can't be undone.")
            }
        }
    }

    /// "Resets in 7h" / "Resets in 45m" from the daemon's next-UTC-midnight reset.
    private var resetsFooter: String {
        guard let me, let reset = ISO8601DateFormatter().date(from: me.resetsAt) else {
            return "Daily usage resets at midnight UTC."
        }
        let seconds = max(0, reset.timeIntervalSinceNow)
        let hours = Int(seconds / 3600)
        let text = hours >= 1 ? "\(hours)h" : "\(max(1, Int(seconds / 60)))m"
        return "Daily usage resets in \(text). A limit of 0 means unlimited."
    }

    private func load() async {
        #if DEBUG
        if DemoData.isActive {
            profile = DemoData.profile
            name = DemoData.profile.displayName ?? ""
            me = Me(
                userId: "u1", email: DemoData.profile.email, plan: DemoData.profile.plan,
                usage: AgentUsage(requests: 128, inputTokens: 2_100_000, outputTokens: 142_000),
                limits: AgentLimits(rpm: 30, concurrency: 2, dailyRequests: 500, dailyInput: 5_000_000, dailyOutput: 300_000),
                resetsAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 3600))
            )
            return
        }
        #endif
        do {
            let p = try await Api.shared.getProfile()
            profile = p
            name = p.displayName ?? ""
        } catch {
            self.error = error.localizedDescription
        }
        // Usage is best-effort and independent of the profile — the panel still
        // renders (and the meters simply stay hidden) if this call fails.
        me = try? await Api.shared.getMe()
    }

    private func deleteAccount() {
        deleting = true
        error = nil
        Task {
            defer { deleting = false }
            do {
                try await Api.shared.deleteAccount()
                model.signOut(serverAlreadyDeleted: true)
                dismiss()
            } catch {
                self.error = "Couldn't delete your account: \(error.localizedDescription)"
            }
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != profile?.displayName else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                profile = try await Api.shared.updateProfile(displayName: trimmed)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// One labeled usage meter: used-of-limit with a track + fill. A `limit` of 0 means
/// that limit is disabled, so we show "unlimited" and a quiet full-width track. The
/// fill turns amber past 80% so a user sees a cap approaching before it bites.
private struct UsageMeter: View {
    let label: String
    let used: Int
    let limit: Int

    private var fraction: Double { limit > 0 ? min(1, Double(used) / Double(limit)) : 0 }
    private var fillColor: Color { fraction >= 0.8 ? Theme.attention : Theme.celadonBright }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).foregroundStyle(Theme.ink)
                Spacer()
                Text(limit > 0 ? "\(Self.compact(used)) / \(Self.compact(limit))" : "\(Self.compact(used)) · unlimited")
                    .font(.caption.monospacedDigit()).foregroundStyle(Theme.dim)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.panelHi).frame(height: 6)
                    Capsule().fill(fillColor).frame(width: geo.size.width * fraction, height: 6)
                }
            }
            .frame(height: 6)
        }
        .padding(.vertical, 4)
    }

    /// 1_234 → "1,234", 45_000 → "45k", 2_100_000 → "2.1M".
    static func compact(_ n: Int) -> String {
        switch n {
        case 1_000_000...:
            return String(format: "%.1fM", Double(n) / 1_000_000).replacingOccurrences(of: ".0M", with: "M")
        case 10_000...:
            return "\(n / 1000)k"
        default:
            return n.formatted(.number.grouping(.automatic))
        }
    }
}
