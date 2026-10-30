import Foundation
import SwiftUI

/// What this install *is*: channel, version, build number, commit and the daemon
/// it talks to. One source of truth for the Settings build card, the telemetry
/// test-mode switch and the issue-report context, so the three can't disagree.
///
/// The channel rule (CHANNELS.md): the Dev and Test apps have their own bundle
/// id suffixes; the prod bundle is prod unless it talks to a non-prod daemon
/// (a `CELIADOR_URL` override from an Xcode scheme), in which case the card
/// says test — it shows where the requests actually go.
enum BuildInfo {
    enum Channel: String {
        case dev, test, prod

        /// Short, loud label for pills and the tab badge.
        var label: String {
            switch self {
            case .dev: "DEV"
            case .test: "TEST"
            case .prod: "PROD"
            }
        }

        /// Matches the CI icon banner: red for dev, green for test (CHANNELS.md).
        var color: Color {
            switch self {
            case .dev: Theme.red
            case .test: Theme.added
            case .prod: Theme.accent
            }
        }

        var blurb: String {
            switch self {
            case .dev: "Dev app — a push to main, pointed at dev.celiador.ai."
            case .test: "Test app — a release candidate from a version tag, pointed at test.celiador.ai."
            case .prod: "The App Store build, pointed at celiador.ai."
            }
        }
    }

    static let channel: Channel = {
        let bundle = Bundle.main.bundleIdentifier ?? ""
        if bundle.hasSuffix(".dev") { return .dev }
        if bundle.hasSuffix(".test") { return .test }
        return daemonHost == "celiador.ai" ? .prod : .test
    }()

    /// `CFBundleShortVersionString` — the vX.Y.Z train (`MARKETING_VERSION`).
    static let version: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"

    /// `CFBundleVersion` — CI sets `1000 + run number`; a local build is `1`.
    static let build: String = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"

    /// "0.2.2 (1007)" — the form App Store Connect and TestFlight show.
    static var versionAndBuild: String { "\(version) (\(build))" }

    /// Short commit the Build iOS workflow stamps into `CELIADOR_COMMIT`; nil for
    /// a build from Xcode (the key expands to an empty string).
    static let commit: String? = {
        let value = Bundle.main.object(forInfoDictionaryKey: "CELIADOR_COMMIT") as? String ?? ""
        return value.isEmpty ? nil : value
    }()

    /// Host of the daemon this install talks to (`Api.shared.baseURL`).
    static var daemonHost: String { Api.shared.baseURL.host ?? Api.shared.baseURL.absoluteString }

    /// True when the daemon URL came from the `CELIADOR_URL` env var (an Xcode
    /// scheme) rather than the channel's xcconfig.
    static let daemonIsOverridden: Bool = {
        let env = ProcessInfo.processInfo.environment["CELIADOR_URL"] ?? ""
        return !env.isEmpty
    }()

    /// The whole thing on one line for pasting into an issue:
    /// "Celiador Dev 0.2.2 (1007) · dev · 1a2b3c4 · dev.celiador.ai · iOS 26.1".
    static var summary: String {
        var parts = [
            "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Celiador") \(versionAndBuild)",
            channel.rawValue,
        ]
        if let commit { parts.append(commit) }
        parts.append(daemonHost)
        let os = ProcessInfo.processInfo.operatingSystemVersion
        parts.append("iOS \(os.majorVersion).\(os.minorVersion)" + (os.patchVersion > 0 ? ".\(os.patchVersion)" : ""))
        return parts.joined(separator: " · ")
    }
}
