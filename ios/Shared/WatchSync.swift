#if canImport(WatchConnectivity)
import Foundation
import WatchConnectivity

/// Hands the signed-in Supabase session from the iPhone to the paired Watch, so the
/// watch app can call the daemon without its own sign-in. The iPhone pushes the
/// current session as the WatchConnectivity application context; the watch imports it
/// into `Api` and re-checks. Best-effort — if there's no watch / no session, it no-ops.
final class WatchSync: NSObject, WCSessionDelegate {
    static let shared = WatchSync()

    /// Watch-side: invoked after a session is imported so the UI can refresh.
    var onSessionImported: (() -> Void)?

    private var activated = false

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    #if os(iOS)
    /// Push the current session to the watch. Call on activation and whenever auth changes.
    @MainActor
    func pushSession() {
        guard activated, WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.isPaired, session.isWatchAppInstalled else { return }
        let payload: [String: Any]
        if let current = Api.shared.session, let data = try? JSONEncoder().encode(current) {
            payload = ["session": data]
        } else {
            payload = ["signedOut": true]
        }
        try? session.updateApplicationContext(payload)
    }
    #endif

    #if os(watchOS)
    @MainActor
    private func apply(_ context: [String: Any]) {
        if context["signedOut"] as? Bool == true {
            Api.shared.signOut()
            onSessionImported?()
            return
        }
        guard let data = context["session"] as? Data,
              let session = try? JSONDecoder().decode(Api.AuthSession.self, from: data) else { return }
        Api.shared.importSession(session)
        onSessionImported?()
    }
    #endif

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // Delegate callbacks arrive on a background queue; Api is main-actor isolated.
        let isActivated = activationState == .activated
        #if os(watchOS)
        let context = session.receivedApplicationContext
        #endif
        Task { @MainActor in
            self.activated = isActivated
            #if os(iOS)
            self.pushSession()
            #endif
            #if os(watchOS)
            self.apply(context)
            #endif
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        #if os(watchOS)
        Task { @MainActor in self.apply(applicationContext) }
        #endif
    }

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
    #endif
}
#endif
