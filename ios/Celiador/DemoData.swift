#if DEBUG
import Foundation

/// Static sample data for UI screenshots (gated by the CELIADOR_UI_DEMO env var).
/// DEBUG-only; never compiled into Release.
enum DemoData {
    static var mode: String { ProcessInfo.processInfo.environment["CELIADOR_UI_DEMO"] ?? "" }
    static var isActive: Bool { !mode.isEmpty }

    static func iso(_ ago: TimeInterval) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-ago))
    }

    static let profile = Profile(id: "u1", email: "demo@celiador.ai", displayName: "Stefan", plan: "pro")

    static let diffs: [DiffFile] = [
        DiffFile(id: 1, path: "src/auth/middleware.ts", patch: """
        @@ -12,7 +12,9 @@ export function requireAuth(req, res, next) {
        -  const token = req.headers.authorization
        +  const token = req.headers.authorization?.replace("Bearer ", "")
        +  if (!token) return res.status(401).json({ error: "missing token" })
           // verify the Supabase JWT before continuing
           const user = verify(token, SECRET)
           req.user = user
        """),
        DiffFile(id: 2, path: "src/auth/session.ts", patch: """
        @@ -3,4 +3,6 @@ import { verify } from "./jwt"
        +import { refresh } from "./refresh"
        +
         export async function restore() {
        -  return null
        +  return await refresh()
         }
        """),
    ]

    /// A small workspace tree for the Explorer, keyed by directory path ("" = root).
    static let fileTree: [String: [FileEntry]] = [
        "": [
            FileEntry(name: "src", type: "dir", size: nil),
            FileEntry(name: "README.md", type: "file", size: 1_240),
            FileEntry(name: "package.json", type: "file", size: 512),
        ],
        "src": [
            FileEntry(name: "auth", type: "dir", size: nil),
            FileEntry(name: "index.ts", type: "file", size: 860),
        ],
        "src/auth": [
            FileEntry(name: "middleware.ts", type: "file", size: 734),
            FileEntry(name: "session.ts", type: "file", size: 420),
        ],
    ]

    /// File contents for the code viewer/editor, keyed by path.
    static let fileContents: [String: String] = [
        "src/auth/middleware.ts": """
        import { verify } from "./jwt"

        // Require a valid Supabase bearer token on every protected route.
        export function requireAuth(req, res, next) {
          const token = req.headers.authorization?.replace("Bearer ", "")
          if (!token) return res.status(401).json({ error: "missing token" })
          // verify the Supabase JWT before continuing
          const user = verify(token, SECRET)
          req.user = user
          next()
        }
        """,
        "README.md": """
        # Celiador

        The AI coding editor and its companion app.
        Run an agent, watch it work, and approve changes from your phone.
        """,
    ]

    static let chats: [ChatSummary] = [
        ChatSummary(id: "c1", title: "Refactor auth middleware", origin: "editor", status: "done", updatedAt: iso(7200), lastMessageAt: iso(7200)),
        ChatSummary(id: "c2", title: "Fix flaky checkout test", origin: "editor", status: "error", updatedAt: iso(90000), lastMessageAt: iso(90000)),
        ChatSummary(id: "c3", title: "Add dark-mode toggle to settings", origin: "phone", status: "done", updatedAt: iso(200000), lastMessageAt: iso(200000)),
        ChatSummary(id: "c4", title: "Write onboarding docs", origin: "editor", status: "done", updatedAt: iso(540000), lastMessageAt: iso(540000)),
    ]
}
#endif
