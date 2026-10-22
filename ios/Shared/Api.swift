import Foundation
import Security

/// Client of the Celiador daemon + its Supabase (GoTrue) auth — hand-rolled,
/// dependency-free. Session lives in the Keychain; access tokens refresh
/// automatically on expiry or 401.
final class Api {
    static let shared = Api()

    /// Daemon base URL for this build. Resolution order:
    ///   1. `CELIADOR_URL` env var (dev override, e.g. an Xcode scheme in the simulator)
    ///   2. `CELIADOR_DAEMON_URL` from Info.plist (set per build channel via the xcconfig)
    ///   3. prod fallback
    /// So the Dev/Staging/Release configs point the app at the matching daemon
    /// environment without a code change. See celiador-ios/Config/*.xcconfig.
    let baseURL: URL = {
        let fromEnv = ProcessInfo.processInfo.environment["CELIADOR_URL"]
        let fromPlist = Bundle.main.object(forInfoDictionaryKey: "CELIADOR_DAEMON_URL") as? String
        let raw = [fromEnv, fromPlist]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty } ?? "https://celiador.ai"
        return URL(string: raw)!
    }()

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
        /// HTTP status when the server answered (nil for local/transport errors).
        var status: Int? = nil
        var errorDescription: String? { message }
    }

    /// Pull the most useful message out of a GoTrue / daemon error body. The body
    /// may mix string and non-string fields (e.g. `{"code":400,"msg":"…"}`), which
    /// a strict `[String:String]` decode chokes on — hiding the real reason.
    static func errorMessage(_ data: Data, status: Int, fallback: String) -> String {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for key in ["error_description", "msg", "message", "error_code", "error"] {
                if let value = obj[key] as? String, !value.isEmpty { return value }
            }
        }
        let raw = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (raw?.isEmpty == false ? raw! : fallback)
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

    /// Raw GoTrue POST. Returns the JSON body (throws with the HTTP status on 4xx/5xx).
    private func gotruePost(path: String, query: String? = nil, body: [String: String]) async throws -> Data {
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
            throw ApiError(
                message: Self.errorMessage(data, status: http.statusCode, fallback: "Sign-in failed (\(http.statusCode))."),
                status: http.statusCode
            )
        }
        return data
    }

    private func authRequest(path: String, query: String? = nil, body: [String: String]) async throws -> AuthSession {
        let data = try await gotruePost(path: path, query: query, body: body)
        return storeSession(try JSONDecoder().decode(TokenResponse.self, from: data), fallbackEmail: body["email"])
    }

    @discardableResult
    private func storeSession(_ token: TokenResponse, fallbackEmail: String?) -> AuthSession {
        let session = AuthSession(
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date().addingTimeInterval(TimeInterval(token.expires_in - 60)),
            email: token.user.email ?? fallbackEmail ?? ""
        )
        self.session = session
        Keychain.save(session)
        return session
    }

    func signIn(email: String, password: String) async throws {
        _ = try await authRequest(path: "token", query: "grant_type=password", body: ["email": email, "password": password])
    }

    /// Create an account. Returns true when signed in right away, false when GoTrue
    /// requires email confirmation first (then the response carries no session).
    func signUp(email: String, password: String) async throws -> Bool {
        let data = try await gotruePost(path: "signup", body: ["email": email, "password": password])
        guard let token = try? JSONDecoder().decode(TokenResponse.self, from: data) else { return false }
        storeSession(token, fallbackEmail: email)
        return true
    }

    // MARK: - Pending sign-in (deep-link CSRF guard)

    /// A callback deep link is only accepted while a magic-link / GitHub sign-in
    /// started on this device is pending — otherwise any web page could open
    /// `celiador://auth-callback#access_token=…` and silently swap the account.
    /// Persisted (UserDefaults) because the magic link may be opened after the
    /// app was suspended or killed.
    private static let pendingSignInKey = "pendingSignInAt"
    private static let pendingSignInWindow: TimeInterval = 30 * 60

    private func markSignInPending() {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.pendingSignInKey)
    }

    private func consumePendingSignIn() -> Bool {
        let started = UserDefaults.standard.double(forKey: Self.pendingSignInKey)
        UserDefaults.standard.removeObject(forKey: Self.pendingSignInKey)
        return started > 0 && Date().timeIntervalSince1970 - started < Self.pendingSignInWindow
    }

    // MARK: - Magic link & GitHub OAuth (deep-link callback)

    /// The deep link the magic-link + OAuth flows return to. Tokens arrive in the
    /// URL fragment (implicit flow); completed by `handleAuthCallback`. Must be in
    /// GoTrue's `GOTRUE_URI_ALLOW_LIST`. Channel-aware (see `AppScheme`) so a Dev /
    /// Staging build returns to its own app, not the prod `celiador://`.
    static var authRedirect: String { AppScheme.authCallback }

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
        markSignInPending()
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ApiError(message: "No response.") }
        if http.statusCode >= 400 {
            throw ApiError(message: Self.errorMessage(data, status: http.statusCode, fallback: "Could not send the magic link (\(http.statusCode))."))
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
        markSignInPending()
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
        guard consumePendingSignIn() else { return false } // not started here → ignore
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

    /// In-flight refresh, shared so concurrent 401s don't rotate the refresh token twice
    /// (GoTrue revokes a reused refresh token, which would sign the user out).
    private var refreshTask: Task<AuthSession, Error>?

    @discardableResult
    private func refreshSession() async throws -> AuthSession {
        if let refreshTask { return try await refreshTask.value }
        guard let current = session ?? Keychain.load() else { throw ApiError(message: "Not signed in.") }
        let task = Task {
            try await self.authRequest(
                path: "token",
                query: "grant_type=refresh_token",
                body: ["refresh_token": current.refreshToken]
            )
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    /// Restore from Keychain; refresh if stale. Returns the signed-in email, or nil.
    /// Only a definitive auth rejection (GoTrue 4xx, e.g. a revoked refresh token)
    /// clears the stored session — a network failure (offline cold start) keeps it,
    /// and the next request refreshes once connectivity is back.
    func restoreSession() async -> String? {
        guard let stored = Keychain.load() else { return nil }
        session = stored
        if stored.expiresAt > Date() { return stored.email }
        do {
            return try await refreshSession().email
        } catch let error as ApiError where (400..<500).contains(error.status ?? 0) {
            signOut()
            return nil
        } catch {
            return stored.email
        }
    }

    func signOut() {
        session = nil
        Keychain.delete()
    }

    /// Install a session handed over from the paired iPhone (WatchConnectivity). Lets
    /// the watch app call the daemon without its own sign-in.
    func importSession(_ s: AuthSession) {
        session = s
        Keychain.save(s)
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
        query: [URLQueryItem]? = nil,
        body: Encodable? = nil,
        retrying: Bool = false
    ) async throws -> T {
        let url: URL
        if let query, !query.isEmpty,
           var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) {
            comps.queryItems = query
            url = comps.url ?? baseURL.appendingPathComponent(path)
        } else {
            url = baseURL.appendingPathComponent(path)
        }
        var request = URLRequest(url: url)
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
            return try await self.request(type, path: path, method: method, query: query, body: body, retrying: true)
        }
        if http.statusCode >= 400 {
            throw ApiError(
                message: Self.errorMessage(data, status: http.statusCode, fallback: "Request failed (\(http.statusCode))."),
                status: http.statusCode
            )
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private struct SessionsEnvelope: Codable { let sessions: [Session] }
    private struct SessionEnvelope: Codable { let session: Session }
    private struct OkEnvelope: Codable { let ok: Bool }
    private struct WorkspacesEnvelope: Codable { let workspaces: [EditorWorkspace] }

    /// All of the user's agent sessions, newest first (the daemon sorts).
    func listSessions() async throws -> [Session] {
        try await request(SessionsEnvelope.self, path: "api/sessions").sessions
    }

    /// The signed-in account summary: identity, plan, and today's agent usage against
    /// the daemon-enforced quota. Powers the Account screen's usage meters. Returned
    /// unwrapped (no envelope), matching the daemon's /api/me shape.
    func getMe() async throws -> Me {
        try await request(Me.self, path: "api/me")
    }

    // MARK: - Agent tasks (the queue)

    private struct TaskEnvelope: Codable { let task: AgentTask }
    private struct ReposEnvelope: Codable { let repos: [String] }

    /// Every task, newest first, plus the parallel limit and the repos whose issues become tasks.
    func listTasks() async throws -> TaskList {
        try await request(TaskList.self, path: "api/tasks")
    }

    /// Queue a task by hand on a github.com repo; the editor runs it in its own worktree.
    @discardableResult
    func createTask(remoteUrl: String, title: String, details: String?) async throws -> AgentTask {
        struct Body: Encodable { let remoteUrl: String; let title: String; let details: String? }
        return try await request(TaskEnvelope.self, path: "api/tasks", method: "POST", body: Body(remoteUrl: remoteUrl, title: title, details: details)).task
    }

    func cancelTask(_ id: String) async throws {
        _ = try await request(TaskEnvelope.self, path: "api/tasks/\(id)/cancel", method: "POST")
    }

    /// Make (or stop making) this repo's GitHub issues labelled `celiador` into tasks for you.
    @discardableResult
    func setRepoWatched(_ remoteUrl: String, watched: Bool) async throws -> [String] {
        try await request(ReposEnvelope.self, path: "api/tasks/repos", method: watched ? "POST" : "DELETE", body: ["remoteUrl": remoteUrl]).repos
    }

    /// Repos currently open in the user's editor(s), for the "from your editor"
    /// repo picker. Best-effort presence — empty when no editor is connected.
    func editorWorkspaces() async throws -> [EditorWorkspace] {
        try await request(WorkspacesEnvelope.self, path: "api/presence/workspaces").workspaces
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

    /// Start a server-side (cloud) run: the daemon clones `repoURL` and runs the agent
    /// itself — no desktop needed. Returns the created session to watch.
    @discardableResult
    func startServerRun(repoURL: String, branch: String?, prompt: String) async throws -> Session {
        struct Body: Encodable {
            let origin = "phone"
            let runner = "server"
            let title: String
            let prompt: String
            let repo: Repo
            struct Repo: Encodable { let url: String; let branch: String? }
        }
        let title = String(prompt.prefix(80))
        return try await request(
            SessionEnvelope.self,
            path: "api/sessions",
            method: "POST",
            body: Body(title: title, prompt: prompt, repo: .init(url: repoURL, branch: branch))
        ).session
    }

    /// Ask the user's editor to run an agent on a repo it already has open — on the
    /// local working copy, no clone, no credentials. The editor starts the session;
    /// it appears in the list shortly via the relay. Throws with status 409 when no
    /// editor is online. Returns the request id (for correlation/logging).
    @discardableResult
    func requestEditorRun(remoteUrl: String, name: String?, branch: String?, prompt: String) async throws -> String {
        struct Body: Encodable { let remoteUrl: String; let name: String?; let branch: String?; let prompt: String }
        struct Resp: Decodable { let ok: Bool; let requestId: String; let delivered: Int }
        return try await request(
            Resp.self,
            path: "api/presence/requests",
            method: "POST",
            body: Body(remoteUrl: remoteUrl, name: name, branch: branch, prompt: prompt)
        ).requestId
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

    // MARK: - Workspace files (the session's repo, via the daemon)

    private struct FilesEnvelope: Codable { let entries: [FileEntry] }

    /// List a directory in the session's workspace (`path` relative to the repo root).
    func listFiles(sessionId: String, path: String = "") async throws -> [FileEntry] {
        try await request(
            FilesEnvelope.self,
            path: "api/sessions/\(sessionId)/files",
            query: path.isEmpty ? nil : [URLQueryItem(name: "path", value: path)]
        ).entries
    }

    /// Read a UTF-8 file from the session's workspace.
    func readFile(sessionId: String, path: String) async throws -> FileContent {
        try await request(
            FileContent.self,
            path: "api/sessions/\(sessionId)/file",
            query: [URLQueryItem(name: "path", value: path)]
        )
    }

    /// Write a file in the session's workspace.
    func writeFile(sessionId: String, path: String, content: String) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/sessions/\(sessionId)/file",
            method: "PUT",
            body: ["path": path, "content": content]
        )
    }

    // MARK: - Run review (git in the editor's working copy, via the relay)

    /// What the run changed: current branch + changed files, fresh from the
    /// editor's git (not the possibly-stale diff events in the transcript).
    func gitStatus(sessionId: String) async throws -> GitStatus {
        try await request(GitStatus.self, path: "api/sessions/\(sessionId)/git/status")
    }

    /// Unified diff — one file when `path` is set, the whole working copy otherwise.
    func gitDiff(sessionId: String, path: String? = nil) async throws -> String {
        struct Resp: Decodable { let patch: String }
        return try await request(
            Resp.self,
            path: "api/sessions/\(sessionId)/git/diff",
            query: path.map { [URLQueryItem(name: "path", value: $0)] }
        ).patch
    }

    /// Commit the run's changes (all changed files, or just `paths`) with the
    /// user's own git identity on the Mac. Returns the new commit sha when known.
    @discardableResult
    func gitCommit(sessionId: String, message: String, paths: [String]? = nil) async throws -> String? {
        struct Body: Encodable { let message: String; let paths: [String]? }
        struct Resp: Decodable { let ok: Bool; let sha: String? }
        return try await request(
            Resp.self,
            path: "api/sessions/\(sessionId)/git/commit",
            method: "POST",
            body: Body(message: message, paths: paths)
        ).sha
    }

    /// Discard the working-copy changes to `paths` (tracked → checkout, untracked → delete).
    func gitRevert(sessionId: String, paths: [String]) async throws {
        _ = try await request(
            OkEnvelope.self,
            path: "api/sessions/\(sessionId)/git/revert",
            method: "POST",
            body: ["paths": paths]
        )
    }

    /// Push the run's branch to its remote (setting upstream) with the Mac's credentials.
    @discardableResult
    func gitPush(sessionId: String) async throws -> GitPushResult {
        try await request(GitPushResult.self, path: "api/sessions/\(sessionId)/git/push", method: "POST")
    }

    /// Open the pull request for the run's branch (the editor's GitHub sign-in does it;
    /// without one you get a compare link instead). `base` defaults to the repo's default branch.
    func gitOpenPullRequest(sessionId: String, title: String, body: String?, base: String? = nil) async throws -> GitPullRequest {
        struct Body: Encodable { let title: String; let body: String?; let base: String? }
        return try await request(
            GitPullRequest.self,
            path: "api/sessions/\(sessionId)/git/pr",
            method: "POST",
            body: Body(title: title, body: body, base: base)
        )
    }

    /// Merge the run's open pull request ("Approve and merge"). The editor does it
    /// with its GitHub sign-in (or the gh CLI's); the daemon marks the task merged.
    /// A pull request GitHub refuses to merge comes back as a 409 with the reason.
    func gitMergePullRequest(sessionId: String, method: String = "merge") async throws -> GitMergeResult {
        try await request(
            GitMergeResult.self,
            path: "api/sessions/\(sessionId)/git/merge",
            method: "POST",
            body: ["method": method]
        )
    }

    // MARK: - App data (profile + chat history, via the daemon)

    private struct ProfileEnvelope: Codable { let profile: Profile }
    private struct ChatsEnvelope: Codable { let chats: [ChatSummary] }

    /// The signed-in user's profile.
    func getProfile() async throws -> Profile {
        try await request(ProfileEnvelope.self, path: "api/profile").profile
    }

    /// Update the display name (and/or other profile fields).
    @discardableResult
    func updateProfile(displayName: String) async throws -> Profile {
        try await request(
            ProfileEnvelope.self,
            path: "api/profile",
            method: "PATCH",
            body: ["display_name": displayName]
        ).profile
    }

    /// Durable past conversations, newest first.
    func listChats() async throws -> [ChatSummary] {
        try await request(ChatsEnvelope.self, path: "api/chats").chats
    }

    /// One chat with its full message history.
    func getChat(_ id: String) async throws -> ChatDetail {
        try await request(ChatDetail.self, path: "api/chats/\(id)")
    }

    func deleteChat(_ id: String) async throws {
        _ = try await request(OkEnvelope.self, path: "api/chats/\(id)", method: "DELETE")
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

    /// Unregister a device token on behalf of a session that is being signed out.
    /// Uses the captured (outgoing) session explicitly — the live `session` is
    /// already cleared by then — refreshing a stale access token without storing it.
    func unregisterPush(token: String, signingOut outgoing: AuthSession) async {
        var bearer = outgoing.accessToken
        if outgoing.expiresAt <= Date() {
            guard let data = try? await gotruePost(
                path: "token",
                query: "grant_type=refresh_token",
                body: ["refresh_token": outgoing.refreshToken]
            ), let fresh = try? JSONDecoder().decode(TokenResponse.self, from: data) else { return }
            bearer = fresh.access_token
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/push/register"))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["token": token])
        _ = try? await URLSession.shared.data(for: request)
    }

    // MARK: - Account

    /// Permanently delete the signed-in account on the server (GoTrue user, profile,
    /// chat history, relay sessions, push tokens), then clear the local session.
    func deleteAccount() async throws {
        _ = try await request(OkEnvelope.self, path: "api/account", method: "DELETE")
        signOut()
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
