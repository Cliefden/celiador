import Foundation
import PortfolioFeedback

/// In-app issue reporting for testing builds (TestFlight, Xcode, ad hoc): the
/// "Report an issue" row in Account posts a report to the portfolio's shared
/// `report-issue` function, which files it as a GitHub issue in this repo.
/// `PortfolioFeedback` detects the build channel at runtime, so App Store
/// installs render nothing. The configuration is installed at the app root
/// (`CeliadorApp`); the row lives in `AccountView`.
///
/// The app key only identifies this app to the function (it is not a secret);
/// the server also allowlists `ai.celiador.companion` and `.dev`, so all three
/// channels (CHANNELS.md) can report. The gateway needs no anon key.
enum Feedback {
    static let configuration = FeedbackConfiguration(
        endpoint: URL(string: "https://vivum.crawik.com/functions/v1/report-issue")!,
        appKey: "43de0b20999709f10cf3cec853287d24",
        extraContext: { ["channel": channel, "daemon": Api.shared.baseURL.host ?? "unknown"] }
    )

    /// Which build channel the report came from (CHANNELS.md): the Dev app has
    /// its own bundle id suffix; Test is the prod bundle pointed at a non-prod
    /// daemon — the same rule as `Telemetry`'s test mode.
    private static var channel: String {
        if Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true { return "dev" }
        return Api.shared.baseURL.host == "celiador.ai" ? "prod" : "test"
    }
}
