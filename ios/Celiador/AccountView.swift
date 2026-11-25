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
                Section {
                    if let limit = me.limits.dailyUsd {
                        UsageMeter(label: "Agent spend", used: me.usage.costUsd ?? 0, limit: limit, format: RunUsage.formatCost)
                    }
                    UsageMeter(label: "Requests", used: Double(me.usage.requests), limit: Double(me.limits.dailyRequests), format: UsageMeter.compact)
                    // Token caps are off by default (the budget is in dollars): a meter
                    // only when one is set, otherwise the plain count.
                    if me.limits.dailyInput > 0 || me.limits.dailyOutput > 0 {
                        UsageMeter(label: "Input tokens", used: Double(me.usage.inputTokens), limit: Double(me.limits.dailyInput), format: UsageMeter.compact)
                        UsageMeter(label: "Output tokens", used: Double(me.usage.outputTokens), limit: Double(me.limits.dailyOutput), format: UsageMeter.compact)
                    } else {
                        LabeledContent("Tokens", value: Self.tokens(me.usage))
                    }
                } header: {
                    Text("Today's usage")
                } footer: {
                    Text(resetsFooter)
                }
            .listRowBackground(Theme.panel)

                if let period = me.period {
                    Section {
                        LabeledContent("Agent spend", value: RunUsage.formatCost(period.usage.costUsd ?? 0))
                        LabeledContent("Requests", value: UsageMeter.compact(Double(period.usage.requests)))
                        LabeledContent("Tokens", value: Self.tokens(period.usage))
                        if let history = me.history, !history.isEmpty {
                            UsageHistoryChart(days: history, dailyBudget: me.limits.dailyUsd ?? 0)
                        }
                    } header: {
                        Text(Self.periodTitle(period))
                    } footer: {
                        Text(Self.periodFooter(period, historyDays: me.history?.count ?? 0))
                    }
            .listRowBackground(Theme.panel)
                }

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

    /// "2.1M in · 142k out".
    private static func tokens(_ usage: AgentUsage) -> String {
        "\(UsageMeter.compact(Double(usage.inputTokens))) in · \(UsageMeter.compact(Double(usage.outputTokens))) out"
    }

    private static let utcDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// "2026-11-01" → "Nov 1" (template "MMMd"), or "November" ("MMMM"): the day as
    /// the daemon counts it (UTC), in the user's locale.
    static func dayLabel(_ day: String, template: String = "MMMd") -> String {
        guard let date = utcDay.date(from: day) else { return day }
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.setLocalizedDateFormatFromTemplate(template)
        return f.string(from: date)
    }

    /// "November so far".
    private static func periodTitle(_ period: UsagePeriod) -> String {
        "\(dayLabel(period.from, template: "MMMM")) so far"
    }

    private static func periodFooter(_ period: UsagePeriod, historyDays: Int) -> String {
        var text = "Your own usage since \(dayLabel(period.from)), in UTC days. The limits above are per day."
        if historyDays > 0 { text += " The bars are your agent spend for each of the last \(historyDays) days." }
        return text
    }

    private func load() async {
        #if DEBUG
        if DemoData.isActive {
            profile = DemoData.profile
            name = DemoData.profile.displayName ?? ""
            me = DemoData.me
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
    let used: Double
    let limit: Double
    /// How a figure reads: a count (`compact`) or dollars (`RunUsage.formatCost`).
    let format: (Double) -> String

    private var fraction: Double { limit > 0 ? min(1, used / limit) : 0 }
    private var fillColor: Color { fraction >= 1 ? Theme.red : fraction >= 0.8 ? Theme.attention : Theme.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                Spacer()
                Text(limit > 0 ? "\(format(used)) / \(format(limit))" : "\(format(used)) · unlimited")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            ProgressView(value: fraction)
                .tint(fillColor)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// 1_234 → "1,234", 45_000 → "45k", 2_100_000 → "2.1M".
    static func compact(_ value: Double) -> String {
        let n = Int(value.rounded())
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

/// The last days' agent spend as small bars, oldest left, today right. Scaled to
/// the daily budget (a dashed line at the top) unless a day went past it; a day at
/// or over the budget is amber. No bars at all when nothing was spent.
private struct UsageHistoryChart: View {
    /// Newest first, as the daemon sends them.
    let days: [UsageDay]
    let dailyBudget: Double

    private var ordered: [UsageDay] { days.reversed() }
    private var peak: Double { max(dailyBudget, days.map { $0.usage.costUsd ?? 0 }.max() ?? 0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(ordered) { day in
                    let cost = day.usage.costUsd ?? 0
                    let over = dailyBudget > 0 && cost >= dailyBudget
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(over ? Theme.attention : (day.id == days.first?.id ? Theme.accentBright : Theme.accent))
                        .frame(height: peak > 0 && cost > 0 ? max(2, 56 * cost / peak) : 1)
                        .opacity(cost > 0 ? 1 : 0.35)
                        .frame(maxWidth: .infinity, alignment: .bottom)
                }
            }
            .frame(height: 56, alignment: .bottom)
            .overlay(alignment: .top) {
                if dailyBudget > 0 {
                    Rectangle()
                        .stroke(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(Theme.faint)
                        .frame(height: 1)
                        .frame(maxHeight: .infinity, alignment: .top)
                        .offset(y: 56 - 56 * dailyBudget / max(peak, 0.000_001))
                }
            }
            HStack {
                Text(ordered.first.map { AccountView.dayLabel($0.day) } ?? "")
                Spacer()
                if dailyBudget > 0 { Text("Budget \(RunUsage.formatCost(dailyBudget))/day") }
                Spacer()
                Text("Today")
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Agent spend, last \(days.count) days")
        .accessibilityValue(days.map { "\(AccountView.dayLabel($0.day)): \(RunUsage.formatCost($0.usage.costUsd ?? 0))" }.joined(separator: ", "))
    }
}
