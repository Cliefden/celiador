import SwiftUI

@main
struct CeliadorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Theme.celadonBright)
                .onOpenURL { url in
                    guard url.scheme == "celiador" else { return }
                    switch url.host {
                    case "auth-callback":
                        // Magic-link / GitHub OAuth return — tokens in the fragment.
                        if Api.shared.handleAuthCallback(url) { model.didSignIn() }
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
                VStack(spacing: 16) {
                    Text("Celiador")
                        .font(.system(size: 34, design: .serif).italic())
                        .foregroundStyle(Theme.celadonBright)
                    ProgressView()
                }
            case .unreachable(let message):
                VStack(spacing: 12) {
                    Text("Celiador")
                        .font(.system(size: 34, design: .serif).italic())
                        .foregroundStyle(Theme.celadonBright)
                    Text(message).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
                    Button("Retry") { Task { await model.boot() } }
                        .buttonStyle(.bordered)
                }
                .padding(32)
            case .signedOut:
                LoginView()
            case .signedIn:
                NavigationStack(path: $model.path) {
                    SessionsView()
                        .navigationDestination(for: String.self) { id in
                            SessionView(sessionId: id)
                        }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
        .task { await model.boot() }
    }
}
