import SwiftUI

/// Account screen: the signed-in profile (from the daemon's /api/profile), edit the
/// display name, and sign out. Presented as a sheet from the sessions list.
struct AccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var profile: Profile?
    @State private var name = ""
    @State private var error: String?
    @State private var saving = false
    @State private var confirmingDelete = false
    @State private var deleting = false

    private var initials: String {
        let source = (profile?.displayName?.isEmpty == false ? profile?.displayName : profile?.email) ?? "?"
        let parts = source.split(whereSeparator: { $0 == " " || $0 == "@" || $0 == "." })
        let letters = parts.prefix(2).compactMap { $0.first }
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let profile {
                        VStack(spacing: 10) {
                            ZStack {
                                Circle().fill(Theme.accentGradient).frame(width: 64, height: 64)
                                    .shadow(color: Theme.celadon.opacity(0.4), radius: 10, y: 4)
                                Text(initials)
                                    .font(.title2.weight(.bold))
                                    .foregroundStyle(Color(red: 0.04, green: 0.09, blue: 0.07))
                            }
                            Text(profile.displayName?.isEmpty == false ? profile.displayName! : (profile.email ?? "Your account"))
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                            if let email = profile.email {
                                Text(email).font(.caption).foregroundStyle(Theme.dim)
                            }
                            StatusPill(text: "\(profile.plan) plan", color: Theme.celadonBright, icon: "sparkles")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .listRowBackground(Color.clear)
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                            .listRowBackground(Theme.panel)
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }
                            .listRowBackground(Color.clear)
                    }
                }

                if profile != nil {
                    Section {
                        HStack {
                            Text("Display name").foregroundStyle(Theme.ink)
                            Spacer()
                            TextField("Your name", text: $name)
                                .multilineTextAlignment(.trailing)
                                .foregroundStyle(Theme.dim)
                                .submitLabel(.done)
                                .onSubmit(save)
                        }
                    } header: {
                        Text("Profile")
                    }
                    .listRowBackground(Theme.panel)
                }

                Section {
                    Button {
                        Haptics.warning(); model.signOut(); dismiss()
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundStyle(Theme.ink)
                    }
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button(role: .destructive) {
                        Haptics.warning(); confirmingDelete = true
                    } label: {
                        if deleting {
                            HStack { ProgressView(); Text("Deleting account…") }
                        } else {
                            Label("Delete account", systemImage: "trash")
                        }
                    }
                    .disabled(deleting)
                    if let error, profile != nil {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                    }
                } footer: {
                    Text("Permanently deletes your Celiador account, profile, chat history and push registrations. This can't be undone.")
                }
                .listRowBackground(Theme.panel)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(CeliadorBackground())
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if saving {
                        ProgressView()
                    } else if profile != nil {
                        Button("Save", action: save)
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == profile?.displayName)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
            .confirmationDialog(
                "Delete your Celiador account?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete account", role: .destructive, action: deleteAccount)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your account, profile and chat history are permanently deleted. This can't be undone.")
            }
        }
    }

    private func load() async {
        #if DEBUG
        if DemoData.isActive { profile = DemoData.profile; name = DemoData.profile.displayName ?? ""; return }
        #endif
        do {
            let p = try await Api.shared.getProfile()
            profile = p
            name = p.displayName ?? ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteAccount() {
        deleting = true
        error = nil
        Task {
            defer { deleting = false }
            do {
                try await Api.shared.deleteAccount()
                model.signOut(serverAlreadyDeleted: true)
                dismiss()
            } catch {
                self.error = "Couldn't delete your account: \(error.localizedDescription)"
            }
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != profile?.displayName else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                profile = try await Api.shared.updateProfile(displayName: trimmed)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
