import UIKit
import UserNotifications

/// Owns APNs registration and notification handling for the app. The daemon
/// sends an alert when a session needs you (approval, question, error) or
/// finishes while the app is closed; tapping it deep-links into that session.
@MainActor
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    /// Set once the model exists so taps can navigate.
    weak var model: AppModel?

    /// The last token handed to the daemon, so we can deregister on sign-out.
    private(set) var currentToken: String?

    /// Install as the notification delegate. Must happen during app launch
    /// (didFinishLaunching) so a tap that cold-launches the app isn't lost.
    func installDelegate() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Ask permission (once) and register with APNs. Safe to call on every launch.
    func requestAuthorization() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        Task { @MainActor in
            // Only an undetermined status means the system prompt is actually shown.
            let prompted = await center.notificationSettings().authorizationStatus == .notDetermined
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if prompted {
                Telemetry.signal(.permissionPrompt, ["permission": "notifications", "result": granted ? "granted" : "denied"])
            }
            guard granted else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// APNs delivered a device token — hex-encode and hand it to the daemon.
    func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        currentToken = token
        Task {
            do { try await Api.shared.registerPush(token: token, env: Api.shared.pushEnv) }
            catch { Telemetry.error(.push, "register", error) }
        }
    }

    /// Hand over (and forget) the registered token so sign-out can unregister it
    /// with the outgoing session's credentials before they're cleared.
    func takeToken() -> String? {
        defer { currentToken = nil }
        return currentToken
    }

    /// A push tapped before the model existed (cold launch) — opened once it does.
    private var pendingSessionId: String?

    /// Called once the signed-in model exists: install it and replay a pending tap.
    func attach(model: AppModel) {
        self.model = model
        if let id = pendingSessionId {
            pendingSessionId = nil
            model.open(sessionId: id)
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show the banner even in the foreground; SSE keeps the list fresh anyway.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// A tap on the notification opens the session it was about.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        if let id = (info["sessionId"] ?? info["activityId"]) as? String {
            if let model, case .signedIn = model.phase {
                Telemetry.signal(.notificationOpened, ["kind": "push", "appState": "running"])
                model.open(sessionId: id)
            } else {
                Telemetry.signal(.notificationOpened, ["kind": "push", "appState": "launching"])
                pendingSessionId = id
            }
        }
    }
}
