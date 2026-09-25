import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Text("Celiador")
                .font(.system(size: 40, design: .serif).italic())
                .foregroundStyle(Theme.celadonBright)
            Text(isSignUp ? "Create your studio account." : "Sign in to your studio.")
                .foregroundStyle(Theme.dim)
                .padding(.bottom, 12)

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

            Button(action: submit) {
                Text(busy ? "…" : isSignUp ? "Create account" : "Sign in")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || email.isEmpty || password.isEmpty)

            Button(isSignUp ? "Have an account? Sign in" : "New here? Create an account") {
                isSignUp.toggle()
                error = nil
            }
            .font(.footnote)
            .foregroundStyle(Theme.celadonBright)
            .disabled(busy)

            HStack(spacing: 10) {
                Rectangle().fill(Theme.border).frame(height: 1)
                Text("or").font(.footnote).foregroundStyle(Theme.dim)
                Rectangle().fill(Theme.border).frame(height: 1)
            }
            .padding(.vertical, 4)

            Button(action: sendMagicLink) {
                Text("Email me a magic link")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.bordered)
            .disabled(busy || email.isEmpty)

            Button(action: continueWithGitHub) {
                Label("Continue with GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.bordered)
            .disabled(busy)

            if let error {
                Text(error).font(.footnote).foregroundStyle(Theme.red).multilineTextAlignment(.center)
            }
            if let info {
                Text(info).font(.footnote).foregroundStyle(Theme.celadonBright).multilineTextAlignment(.center)
            }
            Spacer()
            Spacer()
        }
        .padding(28)
        .background(Theme.bg)
    }

    private func submit() {
        guard !busy, !email.isEmpty, !password.isEmpty else { return }
        busy = true
        error = nil
        info = nil
        Task {
            do {
                if isSignUp {
                    try await Api.shared.signUp(email: email, password: password)
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
                openURL(try await Api.shared.githubAuthorizeURL())
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
