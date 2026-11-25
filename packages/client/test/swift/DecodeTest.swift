// Decodes sample payloads with the generated types (swift/CeliadorAPI.swift),
// including values a released app can't know yet: an unknown enum value, an
// unknown event `kind` and unknown fields must all decode. Run by
// scripts/swift-test.sh (CI: .github/workflows/client-contract.yml).

import Foundation

typealias API = CeliadorAPI

@main
struct DecodeTest {
    nonisolated(unsafe) static var failures = 0

    static func check(_ condition: Bool, _ message: String, line: Int = #line) {
        if condition {
            print("ok    \(message)")
        } else {
            failures += 1
            print("FAIL  \(message) (line \(line))")
        }
    }

    static func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    static func roundTrip<T: Codable & Equatable>(_ value: T) throws -> Bool {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(T.self, from: data) == value
    }

    static func main() throws {
        // 1. A known event kind.
        let message = try decode(API.SessionEvent.self, """
            {"seq": 3, "at": "2026-11-25T10:00:00.000Z", "kind": "message", "role": "assistant", "text": "Done."}
            """)
        if case .message(let event) = message {
            check(event.seq == 3 && event.role == .assistant && event.text == "Done.", "SessionEvent message decodes")
        } else {
            check(false, "SessionEvent message decodes (got \(message))")
        }
        check(message.kind == "message", "SessionEvent.kind reports the kind")
        check(try roundTrip(message), "SessionEvent round-trips")

        // 2. An event kind this build doesn't know: kept, not thrown.
        let future = try decode(API.SessionEvent.self, """
            {"seq": 7, "at": "2026-11-25T10:00:01.000Z", "kind": "thinking", "text": "hmm", "budget": 1024}
            """)
        if case .unknown(let kind, let payload) = future, case .object(let fields) = payload {
            check(kind == "thinking" && fields["seq"] == .number(7) && fields["budget"] == .number(1024),
                  "unknown SessionEvent kind decodes to .unknown with its payload")
        } else {
            check(false, "unknown SessionEvent kind decodes to .unknown (got \(future))")
        }
        check(try roundTrip(future), "unknown SessionEvent round-trips")

        let command = try decode(API.EditorCommand.self, #"{"kind": "open-file", "path": "README.md"}"#)
        check(command.kind == "open-file", "unknown EditorCommand kind decodes")

        // 3. Unknown enum values and unknown fields in a struct.
        let session = try decode(API.Session.self, """
            {"id": "s1", "userId": "u1", "title": "Fix it", "origin": "watch", "runner": "editor",
             "state": "paused", "runnerConnected": true, "lastSeq": 12,
             "createdAt": "2026-11-25T09:00:00.000Z", "updatedAt": "2026-11-25T09:05:00.000Z",
             "somethingNew": {"a": 1}}
            """)
        check(session.state.rawValue == "paused" && !session.state.isKnown, "unknown SessionState value decodes")
        check(session.origin == API.SessionOrigin(rawValue: "watch"), "unknown SessionOrigin value decodes")
        check(session.runner == .editor && session.runner.isKnown, "known SessionRunner value decodes")
        check(session.usage == nil && session.repo == nil, "absent optional fields are nil")

        let task = try decode(API.Task.self, """
            {"id": "t1", "repo": {"owner": "o", "name": "n", "url": "https://github.com/o/n.git"},
             "title": "T", "prompt": "P", "branch": "b", "source": "issue-label", "state": "pr-open",
             "createdAt": "2026-11-25T09:00:00.000Z", "updatedAt": "2026-11-25T09:00:00.000Z",
             "pr": {"number": 4, "url": "https://github.com/o/n/pull/4", "checks": "none",
                    "updatedAt": "2026-11-25T09:00:00.000Z"}}
            """)
        check(task.state == .prOpen && task.source == .issueLabel, "hyphenated enum values map to camelCase constants")
        check(task.pr?.checks == API.TaskChecks.none, "TaskChecks.none decodes")

        // 4. snake_case rows, nullable fields, free-form settings.
        let profile = try decode(API.ProfileEnvelope.self, """
            {"profile": {"id": "u1", "email": null, "display_name": "Ada", "avatar_url": null, "plan": "free",
                         "settings": {"theme": "dark", "beta": true, "n": 2},
                         "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"}}
            """).profile
        check(profile.displayName == "Ada" && profile.email == nil && profile.avatarUrl == nil, "snake_case keys map to camelCase")
        check(profile.settings["beta"] == .bool(true) && profile.settings["n"] == .number(2), "JSONValue keeps bools and numbers apart")

        // 5. Open objects keep the fields the spec doesn't name.
        let streamEvent = try decode(API.AnthropicStreamEvent.self, #"{"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}}"#)
        check(streamEvent.type == "content_block_delta" && streamEvent.additionalProperties["index"] == .number(0),
              "additionalProperties keeps unnamed fields")
        check(try roundTrip(streamEvent), "additionalProperties round-trip")

        // 6. Untagged unions.
        let fsResult = try decode(API.RunnerFrame.self, #"{"kind": "fs.result", "requestId": "r1", "ok": true, "content": "x"}"#)
        if case .fsResultFrame(let frame) = fsResult {
            check(frame.requestId == "r1" && frame.ok && frame.content == "x", "RunnerFrame fs.result decodes")
        } else {
            check(false, "RunnerFrame fs.result decodes (got \(fsResult))")
        }
        let activity = try decode(API.RunnerFrame.self, #"{"kind": "activity", "text": "Reading"}"#)
        if case .runnerEvent(.activity(let event)) = activity {
            check(event.text == "Reading", "RunnerFrame activity decodes as a RunnerEvent")
        } else {
            check(false, "RunnerFrame activity decodes as a RunnerEvent (got \(activity))")
        }
        let one = try decode(API.WaitlistSignup.self, #"{"email": "a@b.c", "lists": "windows"}"#)
        let many = try decode(API.WaitlistSignup.self, #"{"email": "a@b.c", "lists": ["linux", "solaris"]}"#)
        check(one.lists == .waitlistName(.windows), "oneOf string variant decodes")
        check(many.lists == .array([.linux, API.WaitlistName(rawValue: "solaris")]), "oneOf array variant decodes")

        if failures > 0 {
            print("\(failures) check(s) failed")
            exit(1)
        }
        print("all checks passed")
    }
}
