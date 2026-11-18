import Foundation
import Testing
@testable import Celiador

/// `RunSummary.steps`: the run screen's checklist folded from tool events.
@Suite("Run summary")
struct RunSummaryTests {
    private func event(_ json: String) -> SessionEvent {
        try! JSONDecoder().decode(SessionEvent.self, from: Data(json.utf8))
    }

    private func task(state: String, prUrl: String? = nil) -> AgentTask {
        var json = #"{"id":"t1","repo":{"owner":"o","name":"r","url":"https://github.com/o/r"},"state":"\#(state)""#
        if let prUrl { json += #","prUrl":"\#(prUrl)""# }
        json += "}"
        return try! JSONDecoder().decode(AgentTask.self, from: Data(json.utf8))
    }

    @Test func consecutiveReadsCollapseIntoOneLine() {
        let steps = RunSummary.steps(events: [
            event(#"{"seq":1,"kind":"tool","name":"Read","callId":"a","input":{"file_path":"ios/Shared/Api.swift"}}"#),
            event(#"{"seq":2,"kind":"tool","name":"Read","callId":"b","input":{"file_path":"ios/Celiador/SessionView.swift"}}"#),
        ], task: nil)
        #expect(steps.map(\.text) == ["Read Api.swift and SessionView.swift"])
        #expect(steps.first?.ok == true)
    }

    @Test func editsCommandsAndFailures() {
        let steps = RunSummary.steps(events: [
            event(#"{"seq":1,"kind":"tool","name":"Edit","callId":"a","input":{"file_path":"a.swift"}}"#),
            event(#"{"seq":2,"kind":"tool","name":"Edit","callId":"b","input":{"file_path":"b.swift"}}"#),
            event(#"{"seq":3,"kind":"tool","name":"Edit","callId":"c","input":{"file_path":"c.swift"}}"#),
            event(#"{"seq":4,"kind":"tool","name":"Bash","callId":"d","input":{"command":"xcodebuild -scheme Celiador -destination generic build"}}"#),
            event(#"{"seq":5,"kind":"toolResult","callId":"d","ok":false}"#),
        ], task: nil)
        #expect(steps.map(\.text) == ["Edited 3 files", "Ran xcodebuild … build"])
        #expect(steps.map(\.ok) == [true, false])
    }

    @Test func errorsStayVisibleAndThinkingIsSkipped() {
        let steps = RunSummary.steps(events: [
            event(#"{"seq":1,"kind":"tool","name":"TodoWrite","callId":"a"}"#),
            event(#"{"seq":2,"kind":"error","message":"Rate limited"}"#),
        ], task: nil)
        #expect(steps.map(\.text) == ["Rate limited"])
        #expect(steps.first?.ok == false)
    }

    @Test func liveRunLeavesLastStepInProgress() {
        let steps = RunSummary.steps(events: [
            event(#"{"seq":1,"kind":"tool","name":"Grep","callId":"a"}"#),
            event(#"{"seq":2,"kind":"tool","name":"Read","callId":"b","input":{"path":"x.ts"}}"#),
        ], task: task(state: "running"))
        #expect(steps.map(\.ok) == [true, nil])
    }

    @Test func pullRequestAndMergeCloseItOff() {
        let steps = RunSummary.steps(events: [], task: task(state: "merged", prUrl: "https://github.com/o/r/pull/3"))
        #expect(steps.map(\.text) == ["Opened the pull request", "Merged"])
    }

    @Test(arguments: [
        ("npm test", "npm test"),
        ("xcodebuild -scheme Celiador -destination generic build", "xcodebuild … build"),
        ("git status\ngit diff", "git status"),
    ])
    func abbreviate(command: String, expected: String) {
        #expect(RunSummary.abbreviate(command) == expected)
    }
}
