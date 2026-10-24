import SwiftUI

/// View (and optionally edit) one file from a session's workspace. Read-only by
/// default; the Edit toggle swaps in a monospaced editor and Save writes it back
/// through the daemon. Truncated (very large) files are read-only.
struct CodeFileView: View {
    let sessionId: String
    let path: String

    @State private var text = ""
    @State private var original = ""
    @State private var editing = false
    @State private var saving = false
    @State private var truncated = false
    @State private var phase: LoadPhase = .loading
    @State private var toast: String?

    enum LoadPhase: Equatable { case loading, loaded, offline, binary, failed(String) }

    private var fileName: String { (path as NSString).lastPathComponent }
    private var dirty: Bool { text != original }
    private var canEdit: Bool { phase == .loaded && !truncated }

    var body: some View {
        fileBody
            .background(CeliadorBackground())
            .navigationTitle(fileName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .toast($toast)
            .task { await load() }
    }

    @ViewBuilder private var fileBody: some View {
        switch phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .offline:
            EmptyStateView(icon: "bolt.slash", title: "Editor offline",
                           message: "Open the Celiador desktop app to read this file.")
        case .binary:
            EmptyStateView(icon: "doc.badge.ellipsis", title: "Binary file",
                           message: "This file can't be shown as text.")
        case .failed(let message):
            EmptyStateView(icon: "exclamationmark.triangle", title: "Couldn't open", message: message)
        case .loaded:
            VStack(spacing: 0) {
                if truncated {
                    Label("Large file — showing the first part. Editing is disabled.", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Theme.attention)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(Theme.attention.opacity(0.12))
                }
                if editing {
                    TextEditor(text: $text)
                        .font(.footnote.monospaced())
                        .scrollContentBackground(.hidden)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(8)
                } else {
                    CodeView(text: text)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if editing {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { text = original; editing = false }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView()
                } else {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(!dirty)
                }
            }
        } else if canEdit {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Haptics.tap(); editing = true } label: { Image(systemName: "pencil") }
                    .accessibilityLabel("Edit")
            }
        }
    }

    private func load() async {
        phase = .loading
        #if DEBUG
        if DemoData.isActive {
            text = DemoData.fileContents[path] ?? "// \(path)\n"
            original = text
            truncated = false
            phase = .loaded
            return
        }
        #endif
        do {
            let file = try await Api.shared.readFile(sessionId: sessionId, path: path)
            text = file.content
            original = file.content
            truncated = file.truncated
            phase = .loaded
        } catch let e as Api.ApiError where e.status == 409 {
            phase = .offline
        } catch let e as Api.ApiError where e.status == 415 {
            phase = .binary
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        #if DEBUG
        if DemoData.isActive {
            original = text; editing = false; Haptics.success(); toast = "Saved \(fileName)"
            return
        }
        #endif
        do {
            try await Api.shared.writeFile(sessionId: sessionId, path: path, content: text)
            original = text
            editing = false
            Haptics.success()
            toast = "Saved \(fileName)"
        } catch {
            Haptics.error()
            toast = "Couldn't save — \(error.localizedDescription)"
        }
    }
}
