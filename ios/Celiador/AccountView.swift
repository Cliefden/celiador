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
    @AppStorage(Telemetry.enabledKey) private var telemetryEnabled = true

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
                                Circle().fill(Theme.accentGradient).frame(width: 72, height: 72)
                                    .shadow(color: Theme.accent.opacity(0.35), radius: 14, y: 6)
                                Text(initials)
                                    .font(.title2.weight(.bold))
                                    .foregroundStyle(.white)
                            }
                            Text(profile.displayName?.isEmpty == false ? profile.displayName! : (profile.email ?? "Your account"))
                                .font(.title2.weight(.semibold))
                            if let email = profile.email {
                                Text(email).font(.subheadline).foregroundStyle(.secondary)
                            }
                            StatusPill(text: "\(profile.plan.capitalized) plan", color: Theme.violet, icon: "sparkles")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .listRowBackground(Color.clear)
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                            } else {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowBackground(Color.clear)
                    }
                }

                if profile != nil {
                    Section {
                        HStack {
                            Text("Display name")
                            Spacer()
                            TextField("Your name", text: $name)
                                .multilineTextAlignment(.trailing)
                                .foregroundStyle(.secondary)
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

                    if let tasks = me.tasks {
                        Section {
                            LabeledContent("Merged, last 7 days", value: "\(tasks.mergedLast7Days)")
                            LabeledContent("Waiting for review", value: "\(tasks.prOpen)")
                            LabeledContent("Running now", value: "\(tasks.running) of \(tasks.concurrency)")
                        } header: {
                            Text("Agent pull requests")
                        } footer: {
                            Text("Queued issues become pull requests; the merged count is the one number Celiador steers by.")
                        }
                .listRowBackground(Theme.panel)
                        }
                }

                Section {
                    Label {
                        Text("Your code stays on your machine. Agents run locally; the daemon only relays what you send and never trains on your code.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } icon: {
                        Image(systemName: "lock.shield").foregroundStyle(Theme.accent)
                    }
                }
                .listRowBackground(Theme.panel)

                Section {
                    Toggle(isOn: $telemetryEnabled) {
                        Label("Share anonymous usage data", systemImage: "chart.bar")
                    }
                    .tint(Theme.accent)
                    .onChange(of: telemetryEnabled) { _, enabled in Telemetry.isEnabled = enabled }
                } footer: {
                    Text("Which features get used and what crashes — never your code, prompts, chat, repository names or email. Details at celiador.ai/privacy.")
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button {
                        Haptics.warning(); Telemetry.signal(.signedOut); model.signOut(); dismiss()
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
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
            .brandGround()
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
                resetsAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 3600)),
                tasks: AgentTaskSummary(running: 1, prOpen: 2, mergedLast7Days: 5, concurrency: 3)
            )
            return
        }
        #endif
        do {
            let p = try await Api.shared.getProfile()
            profile = p
            name = p.displayName ?? ""
        } catch {
            Telemetry.error(.profile, "load", error)
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
                Telemetry.signal(.accountDeleted)
                model.signOut(serverAlreadyDeleted: true)
                dismiss()
            } catch {
                Telemetry.error(.account, "delete", error)
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
                Telemetry.error(.profile, "save", error)
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
    private var fillColor: Color { fraction >= 0.8 ? Theme.attention : Theme.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                Spacer()
                Text(limit > 0 ? "\(Self.compact(used)) / \(Self.compact(limit))" : "\(Self.compact(used)) · unlimited")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            ProgressView(value: fraction)
                .tint(fillColor)
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
