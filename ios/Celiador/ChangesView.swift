import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A SourceTree-style review of the changes a run produced: one section per changed
/// file, its unified diff with +/- coloring, a change gutter, and light syntax
/// highlighting on context lines. The companion's "git window" — review on the go.
///
/// Two modes:
/// - **Live review** (`liveSessionId` set, editor run): the file list and diffs come
///   fresh from the editor's git over the relay, and you can COMMIT the run or
///   REVERT individual files from the phone.
/// - **Transcript** (fallback): the diff events the run streamed, read-only — used
///   for cloud runs and when the editor is offline.
struct ChangesView: View {
    let title: String
    let diffs: [DiffFile]
    /// Set for editor runs: enables live git status + commit/revert via the relay.
    var liveSessionId: String?

    @Environment(\.dismiss) private var dismiss
    @State private var toast: String?
    @State private var live: GitStatus?
    @State private var livePatches: [String: String] = [:]
    @State private var loadingLive = false
    @State private var liveUnavailable: String?
    @State private var revertTarget: GitFileStatus?
    @State private var showCommit = false
    @State private var commitMessage = ""
    @State private var committing = false

    /// Live file list projected into the shared DiffFile shape (stable index ids).
    private var shownDiffs: [DiffFile] {
        guard let live else { return diffs }
        return live.files.enumerated().map { DiffFile(id: $0.offset, path: $0.element.path, patch: livePatches[$0.element.path] ?? "") }
    }

    private var isLive: Bool { live != nil }

    private var totals: (added: Int, removed: Int) {
        shownDiffs.reduce(into: (0, 0)) { acc, f in
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
                if shownDiffs.isEmpty {
                    if loadingLive {
                        ProgressView()
                    } else if isLive {
                        EmptyStateView(
                            icon: "checkmark.seal.fill",
                            title: "Working tree clean",
                            message: "Everything in \(live?.branch.map { "“\($0)”" } ?? "the repo") is committed."
                        )
                    } else {
                        EmptyStateView(
                            icon: "checkmark.seal",
                            title: "No changes yet",
                            message: "When this run edits files, the diffs show up here for you to review."
                        )
                    }
                } else {
                    List {
                        ForEach(shownDiffs) { file in
                            Section {
                                DiffBody(patch: file.patch)
                                    .listRowInsets(EdgeInsets())
                                    .listRowBackground(Theme.panel)
                            } header: {
                                fileHeader(file)
                            }
                        }
                        if let liveUnavailable {
                            Text("Live review unavailable — showing the run's streamed diffs. (\(liveUnavailable))")
                                .font(.caption2).foregroundStyle(Theme.dim)
                                .listRowBackground(Color.clear).listRowSeparator(.hidden)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .refreshable { await loadLive() }
                }
            }
            .toast($toast)
            .navigationTitle("Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    if !shownDiffs.isEmpty {
                        let t = totals
                        HStack(spacing: 8) {
                            if let branch = live?.branch {
                                Image(systemName: "arrow.triangle.branch").font(.caption2).foregroundStyle(Theme.dim)
                                Text(branch).font(.caption.monospaced()).foregroundStyle(Theme.dim).lineLimit(1)
                            } else {
                                Text("Changes").font(.headline).foregroundStyle(Theme.ink)
                            }
                            Text("+\(t.added)").font(.caption.monospaced().weight(.semibold)).foregroundStyle(Theme.celadonBright)
                            Text("−\(t.removed)").font(.caption.monospaced().weight(.semibold)).foregroundStyle(Theme.red)
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                if isLive && !shownDiffs.isEmpty {
                    commitBar
                }
            }
            .task { await loadLive() }
            .alert(
                "Discard changes?",
                isPresented: Binding(get: { revertTarget != nil }, set: { if !$0 { revertTarget = nil } }),
                presenting: revertTarget
            ) { file in
                Button("Discard \((file.path as NSString).lastPathComponent)", role: .destructive) { revert(file) }
                Button("Cancel", role: .cancel) {}
            } message: { file in
                Text(file.status == "U"
                    ? "Deletes the new file \(file.path) from the working copy."
                    : "Reverts \(file.path) to its last committed state.")
            }
            .sheet(isPresented: $showCommit) { commitSheet }
        }
    }

    // MARK: - Live review (status + commit/revert over the relay)

    private func loadLive() async {
        guard let sid = liveSessionId else { return }
        loadingLive = live == nil
        do {
            let status = try await Api.shared.gitStatus(sessionId: sid)
            var patches: [String: String] = [:]
            for file in status.files {
                patches[file.path] = (try? await Api.shared.gitDiff(sessionId: sid, path: file.path)) ?? ""
            }
            live = status
            livePatches = patches
            liveUnavailable = nil
        } catch {
            // Editor offline / cloud run → stay on the transcript diffs.
            liveUnavailable = (error as NSError).localizedDescription
        }
        loadingLive = false
    }

    private func revert(_ file: GitFileStatus) {
        guard let sid = liveSessionId else { return }
        Haptics.warning()
        Task {
            do {
                try await Api.shared.gitRevert(sessionId: sid, paths: [file.path])
                toast = "Discarded \((file.path as NSString).lastPathComponent)"
                await loadLive()
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
        }
    }

    private var commitBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.celadonBright)
            Text("\(shownDiffs.count) file\(shownDiffs.count == 1 ? "" : "s") ready to commit")
                .font(.footnote).foregroundStyle(Theme.ink)
            Spacer()
            Button {
                Haptics.tap()
                if commitMessage.isEmpty { commitMessage = title }
                showCommit = true
            } label: {
                Text("Commit…").font(.footnote.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.celadon)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private var commitSheet: some View {
        NavigationStack {
            Form {
                Section("Commit message") {
                    TextField("What changed?", text: $commitMessage, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section {
                    Text("Commits all \(shownDiffs.count) changed file\(shownDiffs.count == 1 ? "" : "s") on \(live?.branch.map { "“\($0)”" } ?? "the current branch"), with your git identity from the Mac.")
                        .font(.footnote).foregroundStyle(Theme.dim)
                }
            }
            .navigationTitle("Commit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showCommit = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if committing {
                        ProgressView()
                    } else {
                        Button("Commit") { commit() }
                            .disabled(commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .presentationDetents([.height(280), .medium])
        }
    }

    private func commit() {
        guard let sid = liveSessionId else { return }
        committing = true
        Task {
            do {
                let sha = try await Api.shared.gitCommit(sessionId: sid, message: commitMessage.trimmingCharacters(in: .whitespacesAndNewlines))
                Haptics.success()
                toast = sha.map { "Committed \(String($0.prefix(7)))" } ?? "Committed"
                commitMessage = ""
                showCommit = false
                await loadLive()
            } catch {
                Haptics.error()
                toast = (error as NSError).localizedDescription
            }
            committing = false
        }
    }

    private func fileHeader(_ file: DiffFile) -> some View {
        let counts = fileCounts(file.patch)
        let status = live?.files.first { $0.path == file.path }
        return HStack(spacing: 8) {
            Image(systemName: SyntaxHighlighter.icon(forPath: file.path)).font(.caption).foregroundStyle(Theme.celadon)
            Text(file.path)
                .font(.caption.monospaced().weight(.medium))
                .foregroundStyle(Theme.ink)
                .lineLimit(1).truncationMode(.middle)
            if let status {
                Text(status.status)
                    .font(.caption2.monospaced().weight(.bold))
                    .foregroundStyle(statusColor(status.status))
            }
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
            if let status {
                Button { revertTarget = status } label: {
                    Image(systemName: "arrow.uturn.backward").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.red.opacity(0.8))
                .accessibilityLabel("Discard changes to \(file.path)")
            }
        }
        .padding(.vertical, 2)
    }

    private func statusColor(_ code: String) -> Color {
        switch code {
        case "A", "U": return Theme.celadonBright
        case "D": return Theme.red
        case "R": return Theme.dim
        default: return Theme.attention
        }
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
