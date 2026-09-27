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

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let profile {
                        LabeledContent("Email", value: profile.email ?? "—")
                        LabeledContent("Plan", value: profile.plan.capitalized)
                        HStack {
                            Text("Name").foregroundStyle(Theme.ink)
                            Spacer()
                            TextField("Display name", text: $name)
                                .multilineTextAlignment(.trailing)
                                .foregroundStyle(Theme.dim)
                                .submitLabel(.done)
                                .onSubmit(save)
                        }
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.red)
                    } else {
                        ProgressView()
                    }
                } header: {
                    Text("Account")
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button("Sign out", role: .destructive) {
                        model.signOut()
                        dismiss()
                    }
                }
                .listRowBackground(Theme.panel)

                Section {
                    Button(role: .destructive) {
                        confirmingDelete = true
                    } label: {
                        if deleting {
                            HStack { ProgressView(); Text("Deleting account…") }
                        } else {
                            Text("Delete account")
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
            .background(Theme.bg)
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
