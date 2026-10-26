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

    /// The ready-to-merge task the `run` demo opens.
    static let readyTaskId = "t49"

    private static func repo(_ name: String) -> AgentTask.Repo {
        .init(owner: "Cliefden", name: name, url: "https://github.com/Cliefden/\(name).git")
    }

    private static func task(
        _ id: String, _ number: Int, _ repoName: String, _ title: String, branch: String, state: String,
        session: String?, runner: String = "mac", started: TimeInterval, finished: TimeInterval? = nil,
        activity: String? = nil, awaiting: AgentTask.Awaiting? = nil, pr: AgentTask.PullRequest? = nil, error: String? = nil
    ) -> AgentTask {
        let r = repo(repoName)
        return AgentTask(
            id: id, repo: r,
            issue: .init(number: number, title: title, url: "https://github.com/Cliefden/\(repoName)/issues/\(number)"),
            title: title, branch: branch, source: "issue-label", state: state, sessionId: session,
            prUrl: pr?.url, error: error, createdAt: iso(started + 30), updatedAt: iso(finished ?? 20),
            runner: runner, machine: runner == "mac" ? "Stefan's MacBook Pro" : nil,
            startedAt: iso(started), finishedAt: finished.map(iso), activity: activity, awaiting: awaiting, pr: pr
        )
    }

    /// The queue as designed (Main.dc.html): two that need you, one ready to
    /// merge, two running, plus a little finished history.
    static let tasks: [AgentTask] = [
        task("t52", 52, "celiador-editor", "Retry the relay with backoff", branch: "52-relay-backoff", state: "running",
             session: "s1", started: 4 * 60 + 10,
             awaiting: .init(kind: "permission", requestId: "r52", text: "Run command: npm test -- relay")),
        task("t58", 58, "daemon", "Add arm64 Linux to the release matrix", branch: "58-arm64-linux", state: "running",
             session: "s58", runner: "cloud", started: 9 * 60 + 5,
             awaiting: .init(kind: "question", requestId: "r58", text: "Build on a hosted arm64 runner, or cross-compile on x64?",
                             choices: ["Hosted arm64 runner", "Cross-compile on x64"])),
        task("t49", 49, "celiador-ios", "Show cloud-run cancel in the session view", branch: "49-cloud-run-cancel", state: "pr-open",
             session: "s49", started: 40 * 60, finished: 28 * 60,
             pr: .init(number: 8, url: "https://github.com/Cliefden/celiador-ios/pull/8", additions: 64, deletions: 11,
                       changedFiles: 3, checks: "passing", mergeable: true, updatedAt: iso(60))),
        task("t61", 61, "celiador-web", "Security page from the docs", branch: "61-security-page", state: "running",
             session: "s61", started: 6 * 60, activity: "Editing src/app/security/page.tsx"),
        task("t63", 63, "daemon", "Self-hosted daemon guide", branch: "63-self-hosted-guide", state: "running",
             session: "s63", runner: "cloud", started: 2 * 60, activity: "Reading deploy/ and README.md"),
        task("t47", 47, "celiador-editor", "Agents view: group runs by repo", branch: "47-group-by-repo", state: "merged",
             session: "s47", started: 5 * 3600, finished: 4 * 3600,
             pr: .init(number: 61, url: "https://github.com/Cliefden/celiador-editor/pull/61")),
        task("t45", 45, "daemon", "Rate-limit the push test endpoint", branch: "45-push-rate-limit", state: "failed",
             session: "s45", runner: "cloud", started: 7 * 3600, finished: 6 * 3600, error: "tests failed"),
    ]

    /// The #49 run's session log: what the One-run checklist summarises.
    static func runEvents(taskId: String) -> [SessionEvent] {
        guard taskId == readyTaskId else { return [] }
        let json = """
        [
          {"seq":1,"kind":"tool","callId":"c1","name":"Read","input":{"file_path":"Celiador/SessionView.swift"}},
          {"seq":2,"kind":"toolResult","callId":"c1","ok":true},
          {"seq":3,"kind":"tool","callId":"c2","name":"Read","input":{"file_path":"Shared/Api.swift"}},
          {"seq":4,"kind":"toolResult","callId":"c2","ok":true},
          {"seq":5,"kind":"tool","callId":"c3","name":"Edit","input":{"file_path":"Celiador/SessionView.swift"}},
          {"seq":6,"kind":"tool","callId":"c4","name":"Edit","input":{"file_path":"Shared/Api.swift"}},
          {"seq":7,"kind":"tool","callId":"c5","name":"Edit","input":{"file_path":"Shared/Models.swift"}},
          {"seq":8,"kind":"tool","callId":"c6","name":"Bash","input":{"command":"xcodebuild -scheme Celiador -destination 'generic/platform=iOS Simulator' build"}},
          {"seq":9,"kind":"toolResult","callId":"c6","ok":true}
        ]
        """
        return (try? JSONDecoder().decode([SessionEvent].self, from: Data(json.utf8))) ?? []
    }

    /// A patch whose first hunk is `head` and whose totals come to +adds −dels.
    private static func patch(_ head: [String], adds: Int, dels: Int) -> String {
        let headAdds = head.filter { $0.hasPrefix("+") }.count
        let headDels = head.filter { $0.hasPrefix("-") || $0.hasPrefix("−") }.count
        var lines = head
        lines.append("@@ -120,8 +122,\(8 + adds - dels) @@")
        lines += Array(repeating: "+    // …", count: max(0, adds - headAdds))
        lines += Array(repeating: "-    // …", count: max(0, dels - headDels))
        return lines.joined(separator: "\n")
    }

    /// The #49 run's changed files (Changes · 3 files).
    static func runDiffs(taskId: String) -> [DiffFile] {
        guard taskId == readyTaskId else { return [] }
        return [
            DiffFile(id: 1, path: "Celiador/SessionView.swift", patch: patch([
                "@@ toolbar @@",
                "+ if session.runner == .server {",
                "+   Button(\"Cancel run\") { cancel() }",
                "-   Button(\"Stop\") { stop() }",
            ], adds: 48, dels: 9)),
            DiffFile(id: 2, path: "Shared/Api.swift", patch: patch([
                "@@ func cancelSession @@",
                "+ func cancelCloudRun(_ id: String) async throws {",
                "+   _ = try await request(OkEnvelope.self, path: \"api/sessions/\\(id)/cancel\", method: \"POST\")",
            ], adds: 12, dels: 2)),
            DiffFile(id: 3, path: "Shared/Models.swift", patch: patch([
                "@@ struct Session @@",
                "+ var isCloud: Bool { runner == \"server\" }",
            ], adds: 4, dels: 0)),
        ]
    }

    static let chats: [ChatSummary] = [
        ChatSummary(id: "c1", title: "Refactor auth middleware", origin: "editor", status: "done", updatedAt: iso(7200), lastMessageAt: iso(7200)),
        ChatSummary(id: "c2", title: "Fix flaky checkout test", origin: "editor", status: "error", updatedAt: iso(90000), lastMessageAt: iso(90000)),
        ChatSummary(id: "c3", title: "Add dark-mode toggle to settings", origin: "phone", status: "done", updatedAt: iso(200000), lastMessageAt: iso(200000)),
        ChatSummary(id: "c4", title: "Write onboarding docs", origin: "editor", status: "done", updatedAt: iso(540000), lastMessageAt: iso(540000)),
    ]
}
#endif
