import SwiftUI

/// The account screen's usage sections, from `GET /api/me`: today against the
/// daemon-enforced daily limits (the dollar budget first), then this month so
/// far. Every figure is the daemon's own meter, so the phone shows the same
/// numbers the daemon enforces. Works against an older daemon too: without
/// `dailyUsd` it falls back to the token meters it used to show.
struct UsageSections: View {
    let me: Me

    /// The daemon sent a dollar budget (since the dollar cost model).
    private var hasDollarBudget: Bool { me.limits.dailyUsd != nil }

    var body: some View {
        Section {
            if let budget = me.limits.dailyUsd {
                UsageMeter(
                    label: "Agent spend",
                    used: me.usage.costUsd ?? 0,
                    limit: budget,
                    format: { RunUsage.formatCost($0) }
                )
            }
            UsageMeter(label: "Requests", used: Double(me.usage.requests), limit: Double(me.limits.dailyRequests), format: UsageMeter.compact)
            // Token caps are optional once the budget is in dollars; show them only when set.
            if !hasDollarBudget || me.limits.dailyInput > 0 {
                UsageMeter(label: "Input tokens", used: Double(me.usage.inputTokens), limit: Double(me.limits.dailyInput), format: UsageMeter.compact)
            }
            if !hasDollarBudget || me.limits.dailyOutput > 0 {
                UsageMeter(label: "Output tokens", used: Double(me.usage.outputTokens), limit: Double(me.limits.dailyOutput), format: UsageMeter.compact)
            }
        } header: {
            Text("Today's usage")
        } footer: {
            Text(todayFooter)
        }
        .listRowBackground(Theme.panel)

        if let period = me.period {
            Section {
                if let cost = period.usage.costUsd {
                    LabeledContent("Agent spend", value: RunUsage.formatCost(cost))
                }
                LabeledContent("Requests", value: UsageMeter.compact(Double(period.usage.requests)))
                LabeledContent("Tokens in / out", value: "\(UsageMeter.compact(Double(period.usage.inputTokens))) / \(UsageMeter.compact(Double(period.usage.outputTokens)))")
                LabeledContent("Active days", value: "\(period.activeDays)")
            } header: {
                Text(monthTitle(period))
            } footer: {
                Text("This month so far, UTC. Limits are daily; spend is priced at each model's list price, with cache reads and writes at their own rates.")
            }
            .listRowBackground(Theme.panel)
        }
    }

    /// "Resets in 7h" / "Resets in 45m" from the daemon's next-UTC-midnight reset.
    private var todayFooter: String {
        guard let reset = ISO8601DateFormatter.withFractions.date(from: me.resetsAt)
            ?? ISO8601DateFormatter().date(from: me.resetsAt) else {
            return "Daily usage resets at midnight UTC."
        }
        let seconds = max(0, reset.timeIntervalSinceNow)
        let hours = Int(seconds / 3600)
        let text = hours >= 1 ? "\(hours)h" : "\(max(1, Int(seconds / 60)))m"
        return "Daily usage resets in \(text). A limit of 0 means unlimited."
    }

    /// "November" (UTC) from the period's start; "This month" if it can't be read.
    private func monthTitle(_ period: UsagePeriod) -> String {
        guard let start = ISO8601DateFormatter.withFractions.date(from: period.start)
            ?? ISO8601DateFormatter().date(from: period.start) else { return "This month" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMM")
        return formatter.string(from: start)
    }
}

private extension ISO8601DateFormatter {
    /// The daemon's timestamps carry milliseconds (`toISOString()`).
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// One labeled usage meter: used-of-limit with a track + fill. A `limit` of 0 means
/// that limit is disabled, so we show "unlimited" and a quiet full-width track. The
/// fill turns amber past 80% so a user sees a cap approaching before it bites.
struct UsageMeter: View {
    let label: String
    let used: Double
    let limit: Double
    let format: (Double) -> String

    private var fraction: Double { limit > 0 ? min(1, used / limit) : 0 }
    private var fillColor: Color { fraction >= 0.8 ? Theme.attention : Theme.accent }

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
    }

    /// 1_234 → "1,234", 45_000 → "45k", 2_100_000 → "2.1M".
    static func compact(_ value: Double) -> String {
        let n = Int(value)
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
