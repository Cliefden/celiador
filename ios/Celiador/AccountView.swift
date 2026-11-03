import SwiftUI

/// Account screen: the signed-in profile (from the daemon's /api/profile), the
/// display name, today's usage, the pull-request numbers and account deletion.
/// Pushed from the Settings tab (sign-out and preferences live there).
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
                UsageSections(me: me) // today vs. the daily limits + this month (UsageSections.swift)

                if let tasks = me.tasks {
                    Section {
                        LabeledContent("Merged, last 7 days", value: "\(tasks.mergedLast7Days)")
                        LabeledContent("Waiting for review", value: "\(tasks.prOpen)")
                        LabeledContent("Running now", value: "\(tasks.running) of \(tasks.concurrency)")
                        if let cost = tasks.costUsdLast7Days {
                            LabeledContent("Agent spend, last 7 days", value: RunUsage.formatCost(cost))
                        }
                    } header: {
                        Text("Agent pull requests")
                    } footer: {
                        Text(tasks.costUsdLast7Days == nil
                             ? "Queued issues become pull requests; the merged count is the one number Celiador steers by."
                             : "Queued issues become pull requests; the merged count is the one number Celiador steers by. Spend is what those runs cost at Celiador's published rates.")
                    }
            .listRowBackground(Theme.panel)
                    }
            }

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
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView()
                } else if profile != nil {
                    Button("Save", action: save)
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == profile?.displayName)
                }
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

    private func load() async {
        #if DEBUG
        if DemoData.isActive {
            profile = DemoData.profile
            name = DemoData.profile.displayName ?? ""
            me = Me(
                userId: "u1", email: DemoData.profile.email, plan: DemoData.profile.plan,
                usage: AgentUsage(requests: 128, inputTokens: 2_100_000, outputTokens: 142_000, cacheReadTokens: 1_900_000, costUsd: 3.41),
                limits: AgentLimits(rpm: 30, concurrency: 2, dailyRequests: 500, dailyInput: 0, dailyOutput: 0, dailyUsd: 10),
                resetsAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 3600)),
                tasks: AgentTaskSummary(running: 1, prOpen: 2, mergedLast7Days: 5, concurrency: 3, costUsdLast7Days: 4.12),
                period: UsagePeriod(
                    start: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-2 * 86_400)),
                    end: ISO8601DateFormatter().string(from: Date().addingTimeInterval(28 * 86_400)),
                    activeDays: 3,
                    usage: AgentUsage(requests: 342, inputTokens: 6_400_000, outputTokens: 390_000, cacheReadTokens: 5_800_000, costUsd: 9.87)
                )
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
