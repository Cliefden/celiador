import SwiftUI

/// Where an Explorer row navigates: into a subdirectory or open a file. Carries the
/// session id so pushed views keep browsing the right workspace.
enum ExplorerRoute: Hashable {
    case dir(sessionId: String, path: String)
    case file(sessionId: String, path: String)
}

/// The Explorer tab: browse (and edit) the files of the focused agent run's workspace.
/// Served by the daemon — directly for cloud runs, over the relay for desktop runs.
struct ExplorerView: View {
    @Environment(AppModel.self) private var model

    private var focused: Session? {
        guard let id = model.focusedSessionId else { return nil }
        return model.sessions.first { $0.id == id }
    }

    var body: some View {
        Group {
            if let session = focused {
                DirectoryView(sessionId: session.id, path: "", title: session.title)
            } else {
                EmptyStateView(
                    icon: "folder",
                    title: "No workspace yet",
                    message: "Start or open an agent run — its files appear here to browse and edit from your phone."
                )
            }
        }
        .background(CeliadorBackground())
        .navigationTitle("Explorer")
        .toolbar {
            if !model.sessions.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { sessionPicker }
            }
        }
        .navigationDestination(for: ExplorerRoute.self) { route in
            switch route {
            case let .dir(sid, p):
                DirectoryView(sessionId: sid, path: p, title: (p as NSString).lastPathComponent)
            case let .file(sid, p):
                CodeFileView(sessionId: sid, path: p)
            }
        }
    }

    private var sessionPicker: some View {
        Menu {
            ForEach(model.sessions) { s in
                Button {
                    Haptics.select()
                    model.focusedSessionId = s.id
                } label: {
                    if s.id == model.focusedSessionId {
                        Label(s.title, systemImage: "checkmark")
                    } else {
                        Text(s.title)
                    }
                }
            }
        } label: {
            Image(systemName: "rectangle.stack")
        }
        .accessibilityLabel("Choose run")
    }
}

/// One directory listing in a session's workspace.
struct DirectoryView: View {
    let sessionId: String
    let path: String
    let title: String

    @State private var entries: [FileEntry] = []
    @State private var phase: LoadPhase = .loading

    enum LoadPhase: Equatable { case loading, loaded, empty, offline, failed(String) }

    var body: some View {
        content
            .background(CeliadorBackground())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .task(id: sessionId + "::" + path) { await load() }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            List {
                ForEach(0..<6, id: \.self) { _ in SkeletonRow() }
            }
            .listStyle(.insetGrouped)
        case .empty:
            EmptyStateView(icon: "folder", title: "Empty folder", message: "There's nothing in this folder yet.")
        case .offline:
            EmptyStateView(icon: "bolt.slash", title: "Editor offline",
                           message: "Open the Celiador desktop app so the phone can browse this run's files.")
        case .failed(let message):
            EmptyStateView(icon: "exclamationmark.triangle", title: "Couldn't load", message: message)
        case .loaded:
            List {
                ForEach(entries) { entry in
                    NavigationLink(value: route(for: entry)) { FileRow(entry: entry) }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private func route(for entry: FileEntry) -> ExplorerRoute {
        let child = path.isEmpty ? entry.name : path + "/" + entry.name
        return entry.isDir ? .dir(sessionId: sessionId, path: child) : .file(sessionId: sessionId, path: child)
    }

    private func load() async {
        phase = .loading
        #if DEBUG
        if DemoData.isActive {
            entries = DemoData.fileTree[path] ?? []
            phase = entries.isEmpty ? .empty : .loaded
            return
        }
        #endif
        do {
            entries = try await Api.shared.listFiles(sessionId: sessionId, path: path)
            phase = entries.isEmpty ? .empty : .loaded
        } catch let e as Api.ApiError where e.status == 409 {
            phase = .offline
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

private struct FileRow: View {
    let entry: FileEntry

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.isDir ? "folder.fill" : SyntaxHighlighter.icon(forPath: entry.name))
                .foregroundStyle(entry.isDir ? Theme.celadon : Color.secondary)
                .frame(width: 24)
            Text(entry.name)
                .font(.body)
                .lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 6)
            if let size = entry.size, !entry.isDir {
                Text(byteString(size)).font(.subheadline).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private func byteString(_ n: Int) -> String {
        if n < 1024 { return "\(n) B" }
        if n < 1_048_576 { return String(format: "%.0f KB", Double(n) / 1024) }
        return String(format: "%.1f MB", Double(n) / 1_048_576)
    }
}
