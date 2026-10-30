import SwiftUI
import UIKit
import PortfolioFeedback

/// The Settings tab — the portfolio's hub-and-spoke root (SETTINGS_BEST_PRACTICES
/// §1, List lane): a lean list that links out to focused screens. The build card
/// comes first on purpose: a TestFlight Test build *is* the prod app (same bundle
/// id, same icon), so this card — and the DEV/TEST badge on the tab — is what
/// tells a tester which channel they are running and which daemon it talks to.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @AppStorage(Telemetry.enabledKey) private var telemetryEnabled = true
    @State private var toast: String?

    var body: some View {
        List {
            BuildSection { toast = "Build info copied" }

            Section {
                NavigationLink { AccountView().trackScreen(.account) } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(Theme.accentGradient).frame(width: 40, height: 40)
                            Text(initials).font(.subheadline.weight(.bold)).foregroundStyle(.white)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.email ?? "Your account").font(.body.weight(.medium)).lineLimit(1)
                            Text("Profile, usage and pull requests").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text("Account")
            }
            .listRowBackground(Theme.panel)

            Section {
                Button {
                    Haptics.tap()
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                } label: {
                    LabeledContent {
                        Image(systemName: "arrow.up.forward.app").font(.footnote).foregroundStyle(.tertiary)
                    } label: {
                        Label("Notifications", systemImage: "bell.badge")
                    }
                }
                .tint(.primary)
                Toggle(isOn: $telemetryEnabled) {
                    Label("Share anonymous usage data", systemImage: "chart.bar")
                }
                .tint(Theme.accent)
                .onChange(of: telemetryEnabled) { _, enabled in Telemetry.isEnabled = enabled }
                // Testing builds only (TestFlight / Xcode / ad hoc); renders
                // nothing in App Store installs. Configured in Feedback.swift.
                ReportIssueRow()
            } header: {
                Text("Preferences")
            } footer: {
                Text("Usage data is which features get used and what crashes — never your code, prompts, chat, repository names or email. Details at celiador.ai/privacy.")
            }
            .listRowBackground(Theme.panel)

            Section {
                Link(destination: URL(string: "https://celiador.ai/changelog")!) {
                    Label("What's new", systemImage: "sparkles")
                }
                Link(destination: URL(string: "https://celiador.ai/docs")!) {
                    Label("Documentation", systemImage: "book")
                }
                Link(destination: URL(string: "https://celiador.ai/privacy")!) {
                    Label("Privacy policy", systemImage: "hand.raised")
                }
                Link(destination: URL(string: "https://celiador.ai/terms")!) {
                    Label("Terms of service", systemImage: "doc.text")
                }
            } header: {
                Text("About")
            } footer: {
                Label {
                    Text("Your code stays on your machine. Agents run locally; the daemon only relays what you send and never trains on your code.")
                } icon: {
                    Image(systemName: "lock.shield").foregroundStyle(Theme.accent)
                }
            }
            .tint(.primary)
            .listRowBackground(Theme.panel)

            Section {
                Button {
                    Haptics.warning(); Telemetry.signal(.signedOut); model.signOut()
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }
            .listRowBackground(Theme.panel)
        }
        .listStyle(.insetGrouped)
        .brandGround()
        .navigationTitle("Settings")
        .toast($toast)
    }

    private var initials: String {
        let source = model.email ?? "?"
        let parts = source.split(whereSeparator: { $0 == " " || $0 == "@" || $0 == "." })
        let letters = parts.prefix(2).compactMap { $0.first }
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}

/// "This build": channel, version (build), commit and daemon — the one place a
/// tester reads which install they hold. Non-prod channels tint the card in the
/// same colour as the CI icon banner (red dev, green test; CHANNELS.md).
private struct BuildSection: View {
    var onCopy: () -> Void

    private let channel = BuildInfo.channel
    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Celiador"
    }

    var body: some View {
        Section {
            HStack(spacing: 14) {
                IconBadge(systemName: channel == .prod ? "checkmark.seal" : "hammer", color: channel.color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(appName).font(.headline)
                    Text(BuildInfo.versionAndBuild)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(channel.label)
                    .font(.callout.weight(.heavy))
                    .tracking(1)
                    .foregroundStyle(channel == .prod ? AnyShapeStyle(channel.color) : AnyShapeStyle(.white))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(channel == .prod ? channel.color.opacity(0.14) : channel.color, in: Capsule())
                    .accessibilityLabel("\(channel.label) build")
            }
            .padding(.vertical, 4)

            LabeledContent("Daemon") {
                HStack(spacing: 6) {
                    if BuildInfo.daemonIsOverridden {
                        StatusPill(text: "override", color: Theme.attention)
                    }
                    Text(BuildInfo.daemonHost).font(.subheadline.monospaced())
                }
            }
            LabeledContent("Commit") {
                Text(BuildInfo.commit ?? "local build")
                    .font(.subheadline.monospaced())
                    .foregroundStyle(BuildInfo.commit == nil ? .secondary : .primary)
            }
            Button {
                UIPasteboard.general.string = BuildInfo.summary
                Haptics.success()
                onCopy()
            } label: {
                Label("Copy build info", systemImage: "doc.on.doc")
            }
            .tint(.primary)
        } header: {
            Text("This build")
        } footer: {
            Text(channel.blurb)
        }
        .listRowBackground(channel == .prod ? Theme.panel : channel.color.opacity(0.12))
    }
}
