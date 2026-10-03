import SwiftUI

/// A simple SourceTree-style review of the changes a run produced: one section per
/// changed file, its unified diff rendered with +/- line coloring. The companion's
/// "git window" — for reviewing what the agent did on the go.
struct ChangesView: View {
    let title: String
    let diffs: [DiffFile]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if diffs.isEmpty {
                    ContentUnavailableView(
                        "No changes",
                        systemImage: "checkmark.circle",
                        description: Text("This run hasn't changed any files yet.")
                    )
                } else {
                    List {
                        ForEach(diffs) { file in
                            Section {
                                DiffBody(patch: file.patch)
                                    .listRowInsets(EdgeInsets())
                                    .listRowBackground(Theme.panel)
                            } header: {
                                Text(file.path)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(Theme.ink)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .background(Theme.bg)
            .navigationTitle("Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

/// Renders a unified diff with per-line add/remove coloring.
private struct DiffBody: View {
    let patch: String

    private var lines: [(offset: Int, line: String)] {
        Array(patch.split(separator: "\n", omittingEmptySubsequences: false).map(String.init).enumerated())
            .map { ($0.offset, $0.element) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(lines, id: \.offset) { entry in
                Text(entry.line.isEmpty ? " " : entry.line)
                    .font(.caption2.monospaced())
                    .foregroundStyle(color(for: entry.line))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
                    .background(background(for: entry.line))
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 4)
    }

    private func isAdd(_ l: String) -> Bool { l.hasPrefix("+") && !l.hasPrefix("+++") }
    private func isDel(_ l: String) -> Bool { l.hasPrefix("-") && !l.hasPrefix("---") }

    private func color(for line: String) -> Color {
        if isAdd(line) { return Theme.celadonBright }
        if isDel(line) { return Theme.red }
        if line.hasPrefix("@@") { return Theme.dim }
        return Theme.ink
    }

    private func background(for line: String) -> Color {
        if isAdd(line) { return Theme.celadon.opacity(0.10) }
        if isDel(line) { return Theme.red.opacity(0.10) }
        return .clear
    }
}
