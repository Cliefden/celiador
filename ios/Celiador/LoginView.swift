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

    var body: some View {
        ZStack {
            CeliadorBackground()
            ScrollView {
                VStack(spacing: 14) {
                    Spacer(minLength: 48)
                    VStack(spacing: 8) {
                        Wordmark(size: 46)
                        Text(isSignUp ? "Create your studio account" : "Watch and steer your agents")
                            .font(.subheadline)
                            .foregroundStyle(Theme.dim)
                    }
                    .padding(.bottom, 20)

                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .fieldStyle()
                    SecureField("Password", text: $password)
                        .textContentType(isSignUp ? .newPassword : .password)
                        .fieldStyle()
                        .onSubmit(submit)

                    Button(action: { Haptics.tap(); submit() }) {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(Color(red: 0.04, green: 0.09, blue: 0.07)) }
                            Text(busy ? "Signing in…" : isSignUp ? "Create account" : "Sign in")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || email.isEmpty || password.isEmpty)
                    .opacity(busy || email.isEmpty || password.isEmpty ? 0.6 : 1)
                    .padding(.top, 2)

                    Button(isSignUp ? "Have an account? Sign in" : "New here? Create an account") {
                        Haptics.select()
                        withAnimation(Theme.snappy) { isSignUp.toggle() }
                        error = nil
                    }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.celadonBright)
                    .disabled(busy)
                    .padding(.vertical, 2)

                    HStack(spacing: 10) {
                        Rectangle().fill(Theme.border).frame(height: 1)
                        Text("or").font(.caption).foregroundStyle(Theme.faint)
                        Rectangle().fill(Theme.border).frame(height: 1)
                    }
                    .padding(.vertical, 6)

                    Button(action: { Haptics.tap(); sendMagicLink() }) {
                        Label("Email me a magic link", systemImage: "envelope")
                    }
                    .buttonStyle(GhostButtonStyle())
                    .disabled(busy || email.isEmpty)

                    Button(action: { Haptics.tap(); continueWithGitHub() }) {
                        Label("Continue with GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                    }
                    .buttonStyle(GhostButtonStyle())
                    .disabled(busy)

                    if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red).multilineTextAlignment(.center)
                            .transition(.opacity)
                    }
                    if let info {
                        Text(info).font(.footnote).foregroundStyle(Theme.celadonBright).multilineTextAlignment(.center)
                            .transition(.opacity)
                    }
                    Spacer(minLength: 32)
                }
                .padding(.horizontal, 28)
                .animation(Theme.snappy, value: error)
                .animation(Theme.snappy, value: info)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func submit() {
        guard !busy, !email.isEmpty, !password.isEmpty else { return }
        busy = true
        error = nil
        info = nil
        Task {
            do {
                if isSignUp {
                    guard try await Api.shared.signUp(email: email, password: password) else {
                        // Email confirmation is on: the account exists but has no session yet.
                        info = "Account created. Confirm it via the email we sent to \(email), then sign in."
                        isSignUp = false
                        busy = false
                        return
                    }
                } else {
                    try await Api.shared.signIn(email: email, password: password)
                }
                model.didSignIn()
            } catch {
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
                info = "Magic link sent to \(email). Open it on this device to finish signing in."
            } catch {
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
                    model.didSignIn()
                } else {
                    self.error = "GitHub sign-in didn't complete."
                }
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // User closed the sheet — not an error.
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

private extension View {
    func fieldStyle() -> some View {
        padding(14)
            .background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
            .foregroundStyle(Theme.ink)
    }
}
