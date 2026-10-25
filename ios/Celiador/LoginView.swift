import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var canSubmit: Bool { !busy && !email.isEmpty && !password.isEmpty }
    private var headline: String { isSignUp ? "Create your account" : "Sign in" }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Wordmark(size: 44)
                    Text(headline)
                        .font(.title2.weight(.semibold))
                    Text(isSignUp ? "One account for the editor, the phone and the agent." : "Use the account you created in the Celiador editor, or make one here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 56)

                VStack(spacing: 0) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                    Divider().padding(.leading, 16)
                    SecureField("Password", text: $password)
                        .textContentType(isSignUp ? .newPassword : .password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .padding(.horizontal, 16).padding(.vertical, 14)
                }
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))

                VStack(spacing: 12) {
                    Button(action: { Haptics.tap(); submit() }) {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(.white) }
                            Text(busy ? "Signing in…" : isSignUp ? "Create account" : "Sign in")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .primaryButton()
                    .disabled(busy)

                    Button(isSignUp ? "Have an account? Sign in" : "New here? Create an account") {
                        Haptics.select()
                        withAnimation(Theme.snappy) { isSignUp.toggle() }
                        error = nil
                    }
                    .font(.footnote.weight(.medium))
                    .disabled(busy)
                }

                VStack(spacing: 10) {
                    Button(action: { Haptics.tap(); sendMagicLink() }) {
                        Label("Email me a sign-in link", systemImage: "envelope").frame(maxWidth: .infinity)
                    }
                    .secondaryButton()
                    .disabled(busy || email.isEmpty)

                    Button(action: { Haptics.tap(); continueWithGitHub() }) {
                        Label("Continue with GitHub", systemImage: "chevron.left.forwardslash.chevron.right").frame(maxWidth: .infinity)
                    }
                    .secondaryButton()
                    .disabled(busy)
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote).foregroundStyle(Theme.red).multilineTextAlignment(.center)
                        .transition(.opacity)
                }
                if let info {
                    Label(info, systemImage: "checkmark.circle.fill")
                        .font(.footnote).foregroundStyle(Theme.accent).multilineTextAlignment(.center)
                        .transition(.opacity)
                }
                Spacer(minLength: 32)
            }
            .padding(.horizontal, 24)
            .animation(Theme.snappy, value: error)
            .animation(Theme.snappy, value: info)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(CeliadorBackground())
        .onAppear { Telemetry.onboarding(.signInShown) }
    }

    /// `signInFailed` — the failure's fixed code, never its message.
    private func trackFailure(_ method: String, _ error: Error) {
        guard let reason = Telemetry.code(for: error) else { return }
        Telemetry.signal(.signInFailed, ["method": method, "reason": reason])
    }

    private func submit() {
        guard !busy else { return }
        guard !email.isEmpty else { error = "Enter your email address."; focus = .email; return }
        guard !password.isEmpty else { error = "Enter your password."; focus = .password; return }
        busy = true
        error = nil
        info = nil
        Task {
            do {
                if isSignUp {
                    guard try await Api.shared.signUp(email: email, password: password) else {
                        // Email confirmation is on: the account exists but has no session yet.
                        Telemetry.signal(.signUpPendingConfirmation)
                        info = "Account created. Confirm it via the email we sent to \(email), then sign in."
                        isSignUp = false
                        busy = false
                        return
                    }
                } else {
                    try await Api.shared.signIn(email: email, password: password)
                }
                Telemetry.signal(.signedIn, ["method": "password"])
                model.didSignIn()
            } catch {
                trackFailure(isSignUp ? "signUp" : "password", error)
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func sendMagicLink() {
        guard !busy, !email.isEmpty else { return }
        busy = true
        error = nil
        info = nil
        Task {
            do {
                try await Api.shared.sendMagicLink(email: email)
                Telemetry.signal(.magicLinkSent)
                info = "Sign-in link sent to \(email). Open it on this device to finish signing in."
            } catch {
                trackFailure("magicLink", error)
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func continueWithGitHub() {
        guard !busy else { return }
        busy = true
        error = nil
        info = nil
        Task {
            do {
                // In-app auth sheet (not a Safari hand-off): the callback comes
                // straight back here instead of through the URL-scheme handler.
                let url = try await Api.shared.githubAuthorizeURL()
                let callback = try await webAuthenticationSession.authenticate(
                    using: url,
                    callbackURLScheme: AppScheme.scheme
                )
                if Api.shared.handleAuthCallback(callback) {
                    Telemetry.signal(.signedIn, ["method": "github"])
                    model.didSignIn()
                } else {
                    Telemetry.signal(.signInFailed, ["method": "github", "reason": "callbackInvalid"])
                    self.error = "GitHub sign-in didn't complete."
                }
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // User closed the sheet — not an error.
            } catch {
                trackFailure("github", error)
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
