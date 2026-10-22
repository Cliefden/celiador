import Foundation

/// Lifecycle of an agent session, mirroring the daemon's state machine.
enum SessionState: String, Codable {
    case idle, running, awaiting, done, error, cancelled

    /// A run is in flight (or paused waiting on you) — worth a live stream + spinner.
    var isActive: Bool { self == .running || self == .awaiting }

    var label: String {
        switch self {
        case .idle: return "idle"
        case .running: return "working…"
        case .awaiting: return "needs you"
        case .done: return "done"
        case .error: return "failed"
        case .cancelled: return "cancelled"
        }
    }
}

/// A server-side handle on one agent run. The editor (runner) drives it; the phone
/// (watcher) observes and steers. Summary and detail share the same shape today.
struct Session: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let origin: String // "editor" | "phone"
    let runner: String // "editor" | "server"
    let state: SessionState
    let runnerConnected: Bool
    let lastSeq: Int
    let createdAt: String
    let updatedAt: String
}

typealias SessionSummary = Session

/// A repo open in the user's editor(s) right now (daemon presence). Feeds the
/// phone's "from your editor" repo picker; `remoteUrl` is a normalised https
/// clone URL the cloud run can clone directly.
struct EditorWorkspace: Codable, Identifiable, Hashable {
    let name: String
    let remoteUrl: String
    let branch: String?
    var id: String { remoteUrl }
}

/// One entry in a session's event log. The daemon sends a discriminated union
/// keyed by `kind`; we decode leniently so an unknown kind never drops the frame.
struct SessionEvent: Codable, Identifiable, Equatable {
    let seq: Int
    let at: String?
    let kind: String
    // Payloads (all optional; which are set depends on `kind`).
    let text: String?
    let role: String?
    let callId: String?
    let name: String?
    let input: [String: String]?
    let ok: Bool?
    let approvalKind: String?
    let title: String?
    let path: String?
    let preview: String?
    let requestId: String?
    let prompt: String?
    let choices: [String]?
    let patch: String?
    let state: SessionState?
    let message: String?
    let from: Int?

    var id: Int { seq }

    enum CodingKeys: String, CodingKey {
        case seq, at, kind, text, role, callId, name, input, ok, approvalKind, title
        case path, preview, requestId, prompt, choices, patch, state, message, from
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = (try? c.decode(Int.self, forKey: .seq)) ?? 0
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "unknown"
        at = try? c.decodeIfPresent(String.self, forKey: .at)
        text = try? c.decodeIfPresent(String.self, forKey: .text)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        callId = try? c.decodeIfPresent(String.self, forKey: .callId)
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        input = (try? c.decodeIfPresent([String: String].self, forKey: .input)) ?? nil
        ok = try? c.decodeIfPresent(Bool.self, forKey: .ok)
        approvalKind = try? c.decodeIfPresent(String.self, forKey: .approvalKind)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        path = try? c.decodeIfPresent(String.self, forKey: .path)
        preview = try? c.decodeIfPresent(String.self, forKey: .preview)
        requestId = try? c.decodeIfPresent(String.self, forKey: .requestId)
        prompt = try? c.decodeIfPresent(String.self, forKey: .prompt)
        choices = (try? c.decodeIfPresent([String].self, forKey: .choices)) ?? nil
        patch = try? c.decodeIfPresent(String.self, forKey: .patch)
        state = try? c.decodeIfPresent(SessionState.self, forKey: .state)
        message = try? c.decodeIfPresent(String.self, forKey: .message)
        from = try? c.decodeIfPresent(Int.self, forKey: .from)
    }

    /// A short human label for tool calls (e.g. `write_file(src/app.ts)`).
    var toolSummary: String {
        let arg = input?["path"] ?? input?["dir"] ?? ""
        return arg.isEmpty ? (name ?? "tool") : "\(name ?? "tool")(\(arg))"
    }
}

struct DaemonConfig: Codable {
    let authMode: String
    let supabaseUrl: String?
    let supabaseAnonKey: String?
}

// MARK: - App data (served by the daemon: /api/profile, /api/chats)

/// The signed-in user's profile row (public.profiles).
struct Profile: Codable, Identifiable {
    let id: String
    let email: String?
    let displayName: String?
    let plan: String

    enum CodingKeys: String, CodingKey {
        case id, email, plan
        case displayName = "display_name"
    }
}

/// GET /api/me — the signed-in account summary: identity, plan, and today's agent
/// usage against the daemon-enforced daily quota. Mirrors the editor's account
/// panel so both clients show the user the SAME honest numbers the daemon meters.
/// Keys are already camelCase on the wire, so default decoding maps them 1:1.
struct Me: Codable {
    let userId: String
    let email: String?
    /// Billing plan, or nil in token/none (self-host/dev) mode or before a profile row exists.
    let plan: String?
    let usage: AgentUsage
    let limits: AgentLimits
    /// ISO timestamp when the daily counters reset (next UTC midnight).
    let resetsAt: String
    /// Agent task counts (absent on an older daemon).
    let tasks: AgentTaskSummary?
}

/// The account's agent tasks: what runs now, what waits for review, and the
/// pull requests merged in the last seven days — the number Celiador steers by.
struct AgentTaskSummary: Codable {
    let running: Int
    let prOpen: Int
    let mergedLast7Days: Int
    /// Tasks allowed to run at once (published like the other limits).
    let concurrency: Int
}

/// Today's agent usage (UTC day), as metered by the daemon's quota tracker.
struct AgentUsage: Codable {
    let requests: Int
    let inputTokens: Int
    let outputTokens: Int
}

/// Active per-user daily limits. A `0` means that limit is disabled (unlimited).
struct AgentLimits: Codable {
    let rpm: Int
    let concurrency: Int
    let dailyRequests: Int
    let dailyInput: Int
    let dailyOutput: Int
}

/// A durable past conversation (public.chats). A chat is a persisted session.
struct ChatSummary: Codable, Identifiable {
    let id: String
    let title: String?
    let origin: String
    let status: String
    let updatedAt: String
    let lastMessageAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, origin, status
        case updatedAt = "updated_at"
        case lastMessageAt = "last_message_at"
    }
}

/// One durable message within a chat (public.messages). `content` is jsonb `{text}`.
struct ChatMessage: Codable, Identifiable {
    let id: String
    let role: String
    let content: Content
    let seq: Int?
    let createdAt: String

    struct Content: Codable { let text: String? }

    enum CodingKeys: String, CodingKey {
        case id, role, content, seq
        case createdAt = "created_at"
    }

    var text: String { content.text ?? "" }
}

/// Response of GET /api/chats/:id.
struct ChatDetail: Codable {
    let chat: ChatSummary
    let messages: [ChatMessage]
}

// MARK: - Run review (git, served by the editor runner over the relay)

/// One changed file in the session repo's working copy.
struct GitFileStatus: Codable, Identifiable, Hashable {
    let path: String
    /// "M" modified, "A" added, "D" deleted, "R" renamed, "U" untracked.
    let status: String
    var id: String { path }
}

/// The working copy's review state (GET /api/sessions/:id/git/status).
struct GitStatus: Codable {
    let branch: String?
    let files: [GitFileStatus]
}

/// Where the run's branch went (POST /api/sessions/:id/git/push).
struct GitPushResult: Codable {
    let branch: String?
    let remote: String?
}

/// The pull request for the run's branch (POST /api/sessions/:id/git/pr): opened
/// now (`created`), already open, or — when the editor has no GitHub sign-in — a
/// compare link to finish it in the browser.
struct GitPullRequest: Codable {
    let url: String?
    let created: Bool
}

/// The outcome of merging the run's pull request (POST /api/sessions/:id/git/merge).
struct GitMergeResult: Codable {
    let merged: Bool
    let sha: String?
    let url: String?
    /// The agent task that moved to `merged`, when the run belonged to one.
    let taskId: String?
}

// MARK: - Workspace files (served by the daemon: /api/sessions/:id/files|file)

/// One entry in a workspace directory listing.
struct FileEntry: Codable, Identifiable, Hashable {
    let name: String
    let type: String // "file" | "dir"
    let size: Int?

    var id: String { name }
    var isDir: Bool { type == "dir" }
}

/// A file's contents (GET /api/sessions/:id/file). `truncated` when it exceeded the cap.
struct FileContent: Codable {
    let path: String
    let content: String
    let encoding: String
    let truncated: Bool
}

// MARK: - Agent tasks (the queue: GET /api/tasks)

/// One unit of agent work that ends in a pull request: from a GitHub issue
/// (label `celiador` / `@celiador`) or started by hand. The daemon queues it,
/// hands it to the editor (its own worktree + branch) and records the PR.
struct AgentTask: Codable, Identifiable, Hashable {
    struct Repo: Codable, Hashable { let owner: String; let name: String; let url: String }
    struct Issue: Codable, Hashable { let number: Int; let title: String; let url: String }

    let id: String
    let repo: Repo
    let issue: Issue?
    let title: String
    let branch: String
    let source: String
    let state: String
    let sessionId: String?
    let prUrl: String?
    let error: String?
    let createdAt: String
    let updatedAt: String

    /// queued / dispatched / running hold work; the rest are finished.
    var isActive: Bool { ["queued", "dispatched", "running"].contains(state) }
}

struct TaskList: Codable {
    let tasks: [AgentTask]
    let concurrency: Int
    let repos: [String]
}
