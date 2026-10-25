import SwiftUI
import ActivityKit

@main
struct CeliadorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    init() {
        Telemetry.configure()
        Telemetry.signal(.appLaunched, [
            "daysSinceInstall": Telemetry.daysSinceInstall,
            "liveActivities": ActivityAuthorizationInfo().areActivitiesEnabled ? "on" : "off",
        ])
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .tint(Theme.accent)
                .onOpenURL { url in
                    guard url.scheme == AppScheme.scheme else { return }
                    switch url.host {
                    case "auth-callback":
                        // Magic-link / GitHub OAuth return — tokens in the fragment.
                        if Api.shared.handleAuthCallback(url) {
                            Telemetry.signal(.signedIn, ["method": "magicLink"])
                            model.didSignIn()
                        } else {
                            Telemetry.signal(.signInFailed, ["method": "magicLink", "reason": "callbackInvalid"])
                        }
                    case "session":
                        // From widgets, Live Activities, and push taps.
                        let id = url.lastPathComponent
                        if !id.isEmpty {
                            Telemetry.signal(.notificationOpened, ["kind": AppScheme.source(of: url) ?? "deepLink"])
                            model.open(sessionId: id)
                        }
                    default:
                        break
                    }
                }
        }
    }
}

/// Bridges APNs callbacks (device token) into `PushManager`.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Set the notification delegate before launch finishes so a push tap
        // that cold-launched the app is delivered (and replayed after sign-in).
        MainActor.assumeIsolated { PushManager.shared.installDelegate() }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushManager.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Non-fatal: the app still works over SSE; push simply won't arrive.
        Telemetry.error(.push, "apnsRegister", error)
    }
}

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            switch model.phase {
            case .booting:
                BootView()
            case .unreachable(let message):
                UnreachableView(message: message) { Task { await model.boot() } }
                    .trackScreen(.unreachable)
            case .signedOut:
                LoginView()
                    .trackScreen(.login)
            case .signedIn:
                signedInRoot
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CeliadorBackground())
        .animation(Theme.gentle, value: phaseKey)
        .task { await model.boot() }
    }

    @ViewBuilder
    private var signedInRoot: some View {
        #if DEBUG
        switch DemoData.mode {
        case "login":
            LoginView()
        case "session":
            NavigationStack { SessionView(sessionId: "s1") }
        case "changes":
            ChangesView(title: "Refactor auth middleware", diffs: DemoData.diffs)
        case "history":
            NavigationStack { HistoryView() }
        case "account":
            AccountView()
        case "explorer":
            NavigationStack { ExplorerView() }
        case "code":
            NavigationStack { CodeFileView(sessionId: "s1", path: "src/auth/middleware.ts") }
        default:
            TabShell()
        }
        #else
        TabShell()
        #endif
    }

    // A stable key so phase changes cross-fade.
    private var phaseKey: Int {
        switch model.phase {
        case .booting: return 0
        case .unreachable: return 1
        case .signedOut: return 2
        case .signedIn: return 3
        }
    }
}

/// The signed-in shell: Queue (home) · Agents (live runs) · Explorer (files) · Activity (history).
struct TabShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Queue", systemImage: "tray.full", value: AppModel.Tab.queue) {
                NavigationStack(path: $model.queuePath) {
                    QueueView()
                        .trackScreen(.queue)
                        .navigationDestination(for: String.self) { id in SessionView(sessionId: id) }
                }
            }
            .badge(model.needsYouCount)

            Tab("Agents", systemImage: "sparkles", value: AppModel.Tab.agents) {
                NavigationStack(path: $model.agentsPath) {
                    SessionsView()
                        .trackScreen(.agents)
                        .navigationDestination(for: String.self) { id in SessionView(sessionId: id) }
                }
            }

            Tab("Explorer", systemImage: "folder", value: AppModel.Tab.explorer) {
                NavigationStack { ExplorerView().trackScreen(.explorer) }
            }

            Tab("Activity", systemImage: "clock", value: AppModel.Tab.activity) {
                NavigationStack { HistoryView().trackScreen(.activity) }
            }
        }
        .modifier(TabBarBehaviour())
    }
}

/// iOS 26: the glass tab bar tucks away while scrolling down and returns on scroll up.
private struct TabBarBehaviour: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}

/// Branded launch state: the wordmark eases in over the signature glow.
private struct BootView: View {
    @State private var appear = false

    var body: some View {
        VStack(spacing: 20) {
            Wordmark(size: 42)
                .scaleEffect(appear ? 1 : 0.92)
                .opacity(appear ? 1 : 0)
            ProgressView()
                .tint(Theme.accent)
                .opacity(appear ? 1 : 0)
        }
        .onAppear { withAnimation(Theme.spring) { appear = true } }
    }
}

private struct UnreachableView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Wordmark(size: 38)
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.attention)
                .padding(.top, 4)
            Text("Can't reach Celiador")
                .font(.title3.weight(.semibold))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try again") { Haptics.tap(); retry() }
                .primaryButton()
                .padding(.top, 8)
        }
        .padding(32)
    }
}
