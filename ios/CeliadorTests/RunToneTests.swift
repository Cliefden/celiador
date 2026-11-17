import Testing

/// `RunTone` (compiled into this bundle from CeliadorWidgets/RunStyle.swift):
/// the Live Activity's pushed status label and the widget snapshot's bucket must
/// map to the same tones as the app's run rows.
@Suite("Run tone")
struct RunToneTests {
    @Test(arguments: [
        ("needs you", RunTone.needsYou),
        ("failed", .failed),
        ("done", .done),
        ("idle", .idle),
        ("working…", .working),
        ("something new", .working),
    ])
    func status(label: String, tone: RunTone) {
        #expect(RunTone.status(label) == tone)
    }

    @Test func cancelledHasItsOwnLabel() {
        #expect(RunTone.status("cancelled").label == "Cancelled")
    }

    @Test(arguments: [
        ("needs-you", RunTone.needsYou),
        ("working", .working),
        ("error", .failed),
        ("ready", .done),
        ("?", .idle),
    ])
    func bucket(name: String, tone: RunTone) {
        #expect(RunTone.bucket(name) == tone)
    }
}
