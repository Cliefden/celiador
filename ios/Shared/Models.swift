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
    let approvalKind: String?
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
        case seq, at, kind, text, role, callId, name, input, approvalKind
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
        approvalKind = try? c.decodeIfPresent(String.self, forKey: .approvalKind)
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
