import Foundation
import Testing
@testable import Celiador

/// The magic-link / OAuth callback CSRF guard: a `celiador://auth-callback#…`
/// link is only accepted while a sign-in started on this device is pending
/// (`pendingSignInAt` in UserDefaults, 30 minutes), and only once.
@MainActor
@Suite("Auth callback guard", .serialized)
struct AuthCallbackTests {
    private static let pendingKey = "pendingSignInAt"
    private let callback = URL(string: "\(AppScheme.scheme)://auth-callback#access_token=a.b.c&refresh_token=r1&expires_in=3600")!

    init() {
        UserDefaults.standard.removeObject(forKey: Self.pendingKey)
    }

    private func markPending(secondsAgo: TimeInterval = 0) {
        UserDefaults.standard.set(Date().timeIntervalSince1970 - secondsAgo, forKey: Self.pendingKey)
    }

    @Test func rejectedWithoutAPendingSignIn() {
        #expect(!Api.shared.handleAuthCallback(callback))
    }

    @Test func acceptedOnceWhilePending() {
        markPending()
        defer { Api.shared.signOut() }
        #expect(Api.shared.handleAuthCallback(callback))
        #expect(Api.shared.session?.refreshToken == "r1")
        // Consumed: replaying the same link is refused.
        #expect(!Api.shared.handleAuthCallback(callback))
    }

    @Test func rejectedWhenThePendingSignInExpired() {
        markPending(secondsAgo: 31 * 60)
        #expect(!Api.shared.handleAuthCallback(callback))
    }

    @Test func linkWithoutTokensDoesNotConsumeThePendingSignIn() {
        markPending()
        defer { UserDefaults.standard.removeObject(forKey: Self.pendingKey) }
        let bare = URL(string: "\(AppScheme.scheme)://auth-callback#error=access_denied")!
        #expect(!Api.shared.handleAuthCallback(bare))
        #expect(UserDefaults.standard.double(forKey: Self.pendingKey) > 0)
    }
}
