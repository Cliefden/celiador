import Foundation
import Testing
@testable import Celiador

/// The tolerant decoders: a malformed or unknown newer field must never drop a
/// session, a task or a usage row the daemon sent.
@Suite("Tolerant decoding")
struct DecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private let sessionCore = """
    "id":"s1","title":"Fix it","origin":"editor","runner":"editor","state":"running",
    "runnerConnected":true,"lastSeq":7,"createdAt":"2026-11-17T10:00:00Z","updatedAt":"2026-11-17T10:05:00Z"
    """

    @Test func sessionDecodesCoreFields() throws {
        let s = try decode(Session.self, "{\(sessionCore)}")
        #expect(s.id == "s1")
        #expect(s.state == .running)
        #expect(s.lastSeq == 7)
        #expect(s.usage == nil)
        #expect(s.repo == nil)
        #expect(!s.isCloud)
    }

    @Test func sessionSurvivesMalformedUsageAndRepo() throws {
        let s = try decode(Session.self, #"{\#(sessionCore),"usage":"lots","repo":{"url":42}}"#)
        #expect(s.id == "s1")
        #expect(s.usage == nil)
        #expect(s.repo == nil)
    }

    @Test func sessionKeepsWellFormedUsage() throws {
        let s = try decode(Session.self, #"{\#(sessionCore),"usage":{"requests":3,"inputTokens":1200,"outputTokens":300,"costUsd":0.04}}"#)
        #expect(s.usage == RunUsage(requests: 3, inputTokens: 1200, outputTokens: 300, costUsd: 0.04))
    }

    @Test func sessionWithoutRequiredFieldFails() {
        #expect(throws: DecodingError.self) {
            try decode(Session.self, #"{"id":"s1"}"#)
        }
    }

    @Test func runUsageDefaultsAndCoercesNumbers() throws {
        let empty = try decode(RunUsage.self, "{}")
        #expect(empty == RunUsage(requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0))

        let doubles = try decode(RunUsage.self, #"{"requests":2.0,"inputTokens":1500.0,"outputTokens":"x","costUsd":0.5}"#)
        #expect(doubles.requests == 2)
        #expect(doubles.inputTokens == 1500)
        #expect(doubles.outputTokens == 0)
        #expect(doubles.costUsd == 0.5)
    }

    @Test(arguments: [(0.0, "$0.00"), (0.004, "<$0.01"), (0.01, "$0.01"), (0.375, "$0.38"), (12.0, "$12.00")])
    func runUsageCostLabel(usd: Double, label: String) {
        #expect(RunUsage.formatCost(usd) == label)
    }

    private let taskCore = """
    "id":"t1","repo":{"owner":"Cliefden","name":"celiador","url":"https://github.com/Cliefden/celiador"}
    """

    @Test func agentTaskDefaultsMissingFields() throws {
        let t = try decode(AgentTask.self, "{\(taskCore)}")
        #expect(t.id == "t1")
        #expect(t.title == "")
        #expect(t.source == "manual")
        #expect(t.state == "queued")
        #expect(t.isActive)
        #expect(!t.isFinished)
        #expect(t.awaiting == nil)
    }

    @Test func agentTaskSurvivesMalformedNewerFields() throws {
        let t = try decode(AgentTask.self, #"{\#(taskCore),"state":"pr-open","awaiting":"yes","pr":[1],"usage":null,"runner":7}"#)
        #expect(t.state == "pr-open")
        #expect(t.awaiting == nil)
        #expect(t.pr == nil)
        #expect(t.usage == nil)
        #expect(t.runner == nil)
    }

    @Test func agentTaskWithoutRepoFails() {
        #expect(throws: DecodingError.self) {
            try decode(AgentTask.self, #"{"id":"t1"}"#)
        }
    }

    @Test func agentTaskPrNumberFromPrOrUrl() throws {
        let fromPr = try decode(AgentTask.self, #"{\#(taskCore),"pr":{"number":12,"url":"https://github.com/x/y/pull/12"}}"#)
        #expect(fromPr.prNumber == 12)
        let fromUrl = try decode(AgentTask.self, #"{\#(taskCore),"prUrl":"https://github.com/x/y/pull/8/files"}"#)
        #expect(fromUrl.prNumber == 8)
        let none = try decode(AgentTask.self, "{\(taskCore)}")
        #expect(none.prNumber == nil)
    }

    @Test func sessionEventNeverDropsAFrame() throws {
        let unknown = try decode(SessionEvent.self, #"{"kind":"somethingNew","seq":"x"}"#)
        #expect(unknown.kind == "somethingNew")
        #expect(unknown.seq == 0)
        let empty = try decode(SessionEvent.self, "{}")
        #expect(empty.kind == "unknown")
    }
}
