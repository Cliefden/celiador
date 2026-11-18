import Foundation
import Testing
@testable import Celiador

/// The SSE line parser and the reconnect policy (`Shared/Events.swift`).
@Suite("Event stream")
struct StreamTests {
    @Test func decodesDataFrames() throws {
        let event = try #require(SessionEventStream.decode(#"data: {"seq":4,"kind":"message","role":"user","text":"hi"}"#))
        #expect(event.seq == 4)
        #expect(event.kind == "message")
        #expect(event.text == "hi")
    }

    @Test func toleratesNoSpaceAfterColon() throws {
        let event = try #require(SessionEventStream.decode(#"data:{"seq":1,"kind":"delta","text":"x"}"#))
        #expect(event.kind == "delta")
    }

    @Test(arguments: ["id: 4", ": ping", "event: task", "data:", "data:    ", "data: not json", ""])
    func skipsEverythingElse(line: String) {
        #expect(SessionEventStream.decode(line) == nil)
    }

    @Test func jitterStaysWithinHalfToFull() {
        for base in [1.0, 2.0, 30.0] {
            for _ in 0..<50 {
                let d = StreamRetry.jittered(base)
                #expect(d >= base / 2 && d <= base)
            }
        }
    }

    @Test func stopsOnlyWhenRetryingCantHelp() {
        #expect(StreamRetry.shouldStop(after: StreamRetry.SignedOut()))
        #expect(StreamRetry.shouldStop(after: Api.ApiError(message: "gone", status: 404)))
        #expect(StreamRetry.shouldStop(after: Api.ApiError(message: "gone", status: 410)))
        #expect(!StreamRetry.shouldStop(after: Api.ApiError(message: "auth", status: 401)))
        #expect(!StreamRetry.shouldStop(after: Api.ApiError(message: "down", status: 502)))
        #expect(!StreamRetry.shouldStop(after: URLError(.notConnectedToInternet)))
    }

    @Test(arguments: [(400, true), (401, true), (403, true), (408, false), (429, false), (500, false)])
    func refreshRejectionIsDefinitive(status: Int, revoked: Bool) {
        #expect(Api.isRevocation(Api.ApiError(message: "", status: status)) == revoked)
    }

    @Test func transportErrorIsNotARevocation() {
        #expect(!Api.isRevocation(Api.ApiError(message: "offline")))
    }
}
