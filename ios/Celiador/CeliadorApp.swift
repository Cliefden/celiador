import SwiftUI

@main
struct CeliadorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    init() {
        Telemetry.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Theme.celadonBright)
                .onOpenURL { url in
                    guard url.scheme == AppScheme.scheme else { return }
                    switch url.host {
                    case "auth-callback":
                        // Magic-link / GitHub OAuth return — tokens in the fragment.
                        if Api.shared.handleAuthCallback(url) {
                            Telemetry.signal(.signedIn, ["method": "magicLink"])
                            model.didSignIn()
                        }
                    case "session":
                        // From widgets, Live Activities, and push taps.
                        let id = url.lastPathComponent
                        if !id.isEmpty { model.open(sessionId: id) }
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
            case .signedOut:
                LoginView()
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

/// The signed-in IDE shell: Agents (cockpit) · Explorer (files) · Activity (history).
struct TabShell: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            NavigationStack(path: $model.agentsPath) {
                SessionsView()
                    .navigationDestination(for: String.self) { id in SessionView(sessionId: id) }
            }
            .tabItem { Label("Agents", systemImage: "square.stack.3d.up.fill") }
            .badge(model.needsYouCount)
            .tag(AppModel.Tab.agents)

            NavigationStack { ExplorerView() }
                .tabItem { Label("Explorer", systemImage: "folder.fill") }
                .tag(AppModel.Tab.explorer)

            NavigationStack { HistoryView() }
                .tabItem { Label("Activity", systemImage: "clock.fill") }
                .tag(AppModel.Tab.activity)
        }
        .tint(Theme.celadonBright)
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
                .tint(Theme.celadon)
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
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.dim)
                .multilineTextAlignment(.center)
            Button("Try again") { Haptics.tap(); retry() }
                .buttonStyle(PrimaryButtonStyle())
                .frame(maxWidth: 220)
                .padding(.top, 8)
        }
        .padding(32)
    }
}
