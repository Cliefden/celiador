import Foundation
import Security

/// Client of the Celiador daemon + its Supabase (GoTrue) auth — hand-rolled,
/// dependency-free. Session lives in the Keychain; access tokens refresh
/// automatically on expiry or 401.
final class Api {
    static let shared = Api()

    let baseURL = URL(
        string: ProcessInfo.processInfo.environment["CELIADOR_URL"] ?? "https://celiador.ai"
    )!

    private var config: DaemonConfig?
    private(set) var session: AuthSession?

    struct AuthSession: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
        var email: String
    }

    struct ApiError: Error, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: - Bootstrap

    func loadConfig() async throws -> DaemonConfig {
        if let config { return config }
        let (data, _) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("api/config"))
        let decoded = try JSONDecoder().decode(DaemonConfig.self, from: data)
        config = decoded
        return decoded
    }

    // MARK: - Auth (GoTrue)

    private struct TokenResponse: Codable {
        let access_token: String
        let refresh_token: String
        let expires_in: Int
        let user: TokenUser
        struct TokenUser: Codable { let email: String? }
    }

    private func authRequest(path: String, query: String? = nil, body: [String: String]) async throws -> AuthSession {
        let config = try await loadConfig()
        guard let anon = config.supabaseAnonKey else { throw ApiError(message: "Server has no auth configured.") }
        let authBase = URL(string: config.supabaseUrl ?? baseURL.absoluteString)!
        var components = URLComponents(
            url: authBase.appendingPathComponent("auth/v1/\(path)"),
            resolvingAgainstBaseURL: false
        )!
        components.query = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(anon, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ApiError(message: "No response.") }
        if http.statusCode >= 400 {
            let detail = (try? JSONDecoder().decode([String: String].self, from: data))
            throw ApiError(
                message: detail?["error_description"] ?? detail?["msg"] ?? detail?["message"]
                    ?? "Sign-in failed (\(http.statusCode))."
            )
        }
        let token = try JSONDecoder().decode(TokenResponse.self, from: data)
        let session = AuthSession(
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date().addingTimeInterval(TimeInterval(token.expires_in - 60)),
            email: token.user.email ?? body["email"] ?? ""
        )
        self.session = session
        Keychain.save(session)
        return session
    }

    func signIn(email: String, password: String) async throws {
        _ = try await authRequest(path: "token", query: "grant_type=password", body: ["email": email, "password": password])
    }

    func signUp(email: String, password: String) async throws {
        _ = try await authRequest(path: "signup", body: ["email": email, "password": password])
    }

    // MARK: - Magic link & GitHub OAuth (deep-link callback)

    /// The deep link the magic-link + OAuth flows return to. Tokens arrive in the
    /// URL fragment (implicit flow); completed by `handleAuthCallback`. Must be in
    /// GoTrue's `GOTRUE_URI_ALLOW_LIST`. Mirrors the editor's `celiador://…/auth-callback`.
    static let authRedirect = "celiador://auth-callback"

    /// Email a one-tap magic link. Opening it returns to `authRedirect` with tokens.
    func sendMagicLink(email: String) async throws {
        struct OtpBody: Encodable { let email: String; let create_user: Bool }
        let config = try await loadConfig()
        guard let anon = config.supabaseAnonKey else { throw ApiError(message: "Server has no auth configured.") }
        let authBase = URL(string: config.supabaseUrl ?? baseURL.absoluteString)!
        var components = URLComponents(
            url: authBase.appendingPathComponent("auth/v1/otp"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "redirect_to", value: Self.authRedirect)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(anon, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(OtpBody(email: email, create_user: true))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ApiError(message: "No response.") }
        if http.statusCode >= 400 {
            let detail = try? JSONDecoder().decode([String: String].self, from: data)
            throw ApiError(
                message: detail?["error_description"] ?? detail?["msg"] ?? detail?["message"]
                    ?? "Could not send the magic link (\(http.statusCode))."
            )
        }
    }

    /// The GoTrue GitHub authorization URL to open in a browser. After the user
    /// authorizes, GoTrue redirects to `authRedirect` with tokens in the fragment.
    func githubAuthorizeURL() async throws -> URL {
        let config = try await loadConfig()
        let authBase = URL(string: config.supabaseUrl ?? baseURL.absoluteString)!
        var components = URLComponents(
            url: authBase.appendingPathComponent("auth/v1/authorize"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "github"),
            URLQueryItem(name: "redirect_to", value: Self.authRedirect),
        ]
        guard let url = components.url else { throw ApiError(message: "Could not build the sign-in URL.") }
        return url
    }

    /// Complete a magic-link / OAuth sign-in from the `celiador://auth-callback`
    /// deep link (tokens in the fragment). Returns true if a session was stored.
    @discardableResult
    func handleAuthCallback(_ url: URL) -> Bool {
        var parser = URLComponents()
        parser.query = url.fragment ?? url.query // implicit flow → fragment
        let items = parser.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let access = value("access_token"), let refresh = value("refresh_token") else { return false }
        let expiresAt: Date
        if let at = value("expires_at").flatMap(Double.init) {
            expiresAt = Date(timeIntervalSince1970: at - 60)
        } else {
            let expiresIn = Int(value("expires_in") ?? "") ?? 3600
            expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn - 60))
        }
        let session = AuthSession(
            accessToken: access,
            refreshToken: refresh,
            expiresAt: expiresAt,
            email: Self.jwtEmail(access) ?? ""
        )
        self.session = session
        Keychain.save(session)
        return true
    }

    /// Best-effort email from a JWT payload (no signature check — display only).
    private static func jwtEmail(_ token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let email = obj["email"] as? String
        else { return nil }
        return email
    }

    @discardableResult
    private func refreshSession() async throws -> AuthSession {
        guard let current = session ?? Keychain.load() else { throw ApiError(message: "Not signed in.") }
        return try await authRequest(
            path: "token",
            query: "grant_type=refresh_token",
            body: ["refresh_token": current.refreshToken]
        )
    }

    /// Restore from Keychain; refresh if stale. Returns the signed-in email, or nil.
    func restoreSession() async -> String? {
        guard let stored = Keychain.load() else { return nil }
        session = stored
        if stored.expiresAt > Date() { return stored.email }
        do {
            return try await refreshSession().email
        } catch {
            signOut()
            return nil
        }
    }

    func signOut() {
        session = nil
        Keychain.delete()
    }

    /// A non-expired access token, refreshing if needed — for callers that
    /// attach it manually (the SSE stream) instead of going through `request`.
    func validAccessToken() async throws -> String {
        if let current = session ?? Keychain.load() {
            session = current
            if current.expiresAt > Date() { return current.accessToken }
        }
        return try await refreshSession().accessToken
    }

    // MARK: - Daemon API

    private func request<T: Decodable>(
        _ type: T.Type,
        path: String,
        method: String = "GET",
        body: Encodable? = nil,
        retrying: Bool = false
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        if let token = session?.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ApiError(message: "No response.") }
        if http.statusCode == 401, !retrying {
            _ = try await refreshSession()
            return try await self.request(type, path: path, method: method, body: body, retrying: true)
        }
        if http.statusCode >= 400 {
            let detail = try? JSONDecoder().decode([String: String].self, from: data)
            throw ApiError(message: detail?["error"] ?? "Request failed (\(http.statusCode)).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private struct SessionsEnvelope: Codable { let sessions: [Session] }
    private struct SessionEnvelope: Codable { let session: Session }
    private struct OkEnvelope: Codable { let ok: Bool }

    /// All of the user's agent sessions, newest first (the daemon sorts).
    func listSessions() async throws -> [Session] {
        try await request(SessionsEnvelope.self, path: "api/sessions").sessions
    }

    func getSession(_ id: String) async throws -> Session {
        try await request(SessionEnvelope.self, path: "api/sessions/\(id)").session
    }

    /// Create a session (rarely from the phone in v1 — the editor usually creates them).
    @discardableResult
    func createSession(title: String, origin: String = "phone", runner: String = "editor") async throws -> Session {
        try await request(
            SessionEnvelope.self,
            path: "api/sessions",
            method: "POST",
            body: ["title": title, "origin": origin, "runner": runner]
        ).session
    }

    /// Send a follow-up instruction to the runner (409 if no runner is attached).
    func sendMessage(_ id: String, text: String) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/sessions/\(id)/message",
            method: "POST",
            body: ["text": text]
        )
    }

    /// Approve or reject a pending write the agent is blocked on.
    func resolveApproval(_ id: String, requestId: String, approve: Bool) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/sessions/\(id)/approvals/\(requestId)",
            method: "POST",
            body: ["decision": approve ? "approve" : "reject"]
        )
    }

    /// Answer a question the agent asked mid-run.
    func answer(_ id: String, requestId: String, text: String) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/sessions/\(id)/answers/\(requestId)",
            method: "POST",
            body: ["text": text]
        )
    }

    func cancelSession(_ id: String) async throws {
        _ = try await request(OkEnvelope.self, path: "api/sessions/\(id)/cancel", method: "POST")
    }

    func deleteSession(_ id: String) async throws {
        _ = try await request(OkEnvelope.self, path: "api/sessions/\(id)", method: "DELETE")
    }

    // MARK: - Push

    /// APNs environment this build targets — the daemon uses it to pick the
    /// sandbox vs production APNs host.
    var pushEnv: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// Register (or refresh) this device's APNs token so the daemon can alert
    /// when a chat needs you while the app is closed.
    func registerPush(token: String, env: String) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/push/register",
            method: "POST",
            body: ["token": token, "env": env]
        )
    }

    func unregisterPush(token: String) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/push/register",
            method: "DELETE",
            body: ["token": token]
        )
    }

    /// Hand the daemon a Live Activity push token so it can drive lock-screen /
    /// Dynamic Island updates for a running session while the app is suspended.
    /// The activity is scoped to the session id (the daemon's `activityId`).
    func registerActivityToken(sessionId: String, token: String) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/push/activity",
            method: "POST",
            body: ["activityId": sessionId, "token": token, "env": pushEnv]
        )
    }
}

/// Type-erasing box so `request` can take any Encodable body.
private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ wrapped: Encodable) {
        encodeFunc = wrapped.encode
    }
    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}

// MARK: - Keychain

private enum Keychain {
    private static let service = "ai.celiador.companion"
    private static let account = "session"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func save(_ session: Api.AuthSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func load() -> Api.AuthSession? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return try? JSONDecoder().decode(Api.AuthSession.self, from: data)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
