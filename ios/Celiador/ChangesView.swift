import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A SourceTree-style review of the changes a run produced: one section per changed
/// file, its unified diff with +/- coloring, a change gutter, and light syntax
/// highlighting on context lines. The companion's "git window" — review on the go.
struct ChangesView: View {
    let title: String
    let diffs: [DiffFile]
    @Environment(\.dismiss) private var dismiss
    @State private var toast: String?

    private var totals: (added: Int, removed: Int) {
        diffs.reduce(into: (0, 0)) { acc, f in
            for line in f.patch.split(separator: "\n", omittingEmptySubsequences: false) {
                if line.hasPrefix("+") && !line.hasPrefix("+++") { acc.0 += 1 }
                else if line.hasPrefix("-") && !line.hasPrefix("---") { acc.1 += 1 }
            }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CeliadorBackground()
                if diffs.isEmpty {
                    EmptyStateView(
                        icon: "checkmark.seal",
                        title: "No changes yet",
                        message: "When this run edits files, the diffs show up here for you to review."
                    )
                } else {
                    List {
                        ForEach(diffs) { file in
                            Section {
                                DiffBody(patch: file.patch)
                                    .listRowInsets(EdgeInsets())
                                    .listRowBackground(Theme.panel)
                            } header: {
                                fileHeader(file)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .toast($toast)
            .navigationTitle("Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    if !diffs.isEmpty {
                        let t = totals
                        HStack(spacing: 8) {
                            Text("Changes").font(.headline).foregroundStyle(Theme.ink)
                            Text("+\(t.added)").font(.caption.monospaced().weight(.semibold)).foregroundStyle(Theme.celadonBright)
                            Text("−\(t.removed)").font(.caption.monospaced().weight(.semibold)).foregroundStyle(Theme.red)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func fileHeader(_ file: DiffFile) -> some View {
        let counts = fileCounts(file.patch)
        return HStack(spacing: 8) {
            Image(systemName: SyntaxHighlighter.icon(forPath: file.path)).font(.caption).foregroundStyle(Theme.celadon)
            Text(file.path)
                .font(.caption.monospaced().weight(.medium))
                .foregroundStyle(Theme.ink)
                .lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 6)
            Text("+\(counts.added)").font(.caption2.monospaced()).foregroundStyle(Theme.celadonBright)
            Text("−\(counts.removed)").font(.caption2.monospaced()).foregroundStyle(Theme.red)
            Button {
                Haptics.tap()
                #if canImport(UIKit)
                UIPasteboard.general.string = file.patch
                #endif
                toast = "Copied \((file.path as NSString).lastPathComponent)"
            } label: {
                Image(systemName: "doc.on.doc").font(.caption)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.dim)
            .accessibilityLabel("Copy diff")
        }
        .padding(.vertical, 2)
    }

    private func fileCounts(_ patch: String) -> (added: Int, removed: Int) {
        patch.split(separator: "\n", omittingEmptySubsequences: false).reduce(into: (0, 0)) { acc, line in
            if line.hasPrefix("+") && !line.hasPrefix("+++") { acc.0 += 1 }
            else if line.hasPrefix("-") && !line.hasPrefix("---") { acc.1 += 1 }
        }
    }
}

/// Renders a unified diff: per-line add/remove coloring, a change gutter, and light
/// syntax highlighting (strings + comments) on unchanged context lines.
private struct DiffBody: View {
    let patch: String

    private var lines: [(offset: Int, line: String)] {
        Array(patch.split(separator: "\n", omittingEmptySubsequences: false).map(String.init).enumerated())
            .map { ($0.offset, $0.element) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(lines, id: \.offset) { entry in
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(gutter(for: entry.line))
                        .frame(width: 2.5)
                    content(for: entry.line)
                        .font(.caption2.monospaced())
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 1.5)
                        .textSelection(.enabled)
                }
                .background(background(for: entry.line))
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func content(for line: String) -> some View {
        if isAdd(line) {
            Text(line.isEmpty ? " " : line).foregroundStyle(Theme.celadonBright)
        } else if isDel(line) {
            Text(line.isEmpty ? " " : line).foregroundStyle(Theme.red)
        } else if line.hasPrefix("@@") {
            Text(line).foregroundStyle(Theme.dim.opacity(0.9)).italic()
        } else {
            Text(SyntaxHighlighter.highlight(line.isEmpty ? " " : line))
        }
    }

    private func isAdd(_ l: String) -> Bool { l.hasPrefix("+") && !l.hasPrefix("+++") }
    private func isDel(_ l: String) -> Bool { l.hasPrefix("-") && !l.hasPrefix("---") }

    private func gutter(for line: String) -> Color {
        if isAdd(line) { return Theme.celadon }
        if isDel(line) { return Theme.red }
        return .clear
    }

    private func background(for line: String) -> Color {
        if isAdd(line) { return Theme.celadon.opacity(0.10) }
        if isDel(line) { return Theme.red.opacity(0.10) }
        return .clear
    }
}
