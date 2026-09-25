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

    /// Ask permission (once) and register with APNs. Safe to call on every launch.
    func requestAuthorization() {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            Task { @MainActor in UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// APNs delivered a device token — hex-encode and hand it to the daemon.
    func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        currentToken = token
        Task { try? await Api.shared.registerPush(token: token, env: Api.shared.pushEnv) }
    }

    /// Best-effort deregister so a signed-out device stops receiving alerts.
    func deregister() {
        guard let token = currentToken else { return }
        currentToken = nil
        Task { try? await Api.shared.unregisterPush(token: token) }
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
            model?.open(sessionId: id)
        }
    }
}
