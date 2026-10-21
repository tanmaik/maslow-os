import SwiftUI

// You: who this phone is signed in as, the org and the others you may move
// to, the settings that are yours, and the way out.
struct YouView: View {
  @Environment(Session.self) private var session
  @Environment(Push.self) private var push
  @State private var busy = false
  @State private var said: String?
  @State private var leaving = false
  // Set when the server could not be reached at all, which is the one case
  // where the phone offers to forget a session it cannot end.
  @State private var stranded = false
  @State private var forgetting = false

  var body: some View {
    NavigationStack {
      List {
        if let held = session.held {
          Section { who(held) }
          Section("Yours") {
            NavigationLink { LookPane() } label: {
              Label("Look", systemImage: "paintpalette.fill")
            }
          }
          Section {
            orgs(held.orgs)
          } header: {
            Text("Org")
          } footer: {
            if held.orgs.count > 1 { Text("Everything you see is the org you are in.") }
          }
          Section {
            Button("Sign out the others") { Task { await signOutOthers() } }
              .disabled(busy)
              .frame(minHeight: 44)
            Button("Sign out", role: .destructive) { leaving = true }
              .disabled(busy)
              .frame(minHeight: 44)
            if stranded {
              Button("Forget this session on this phone", role: .destructive) {
                forgetting = true
              }
              .disabled(busy)
              .frame(minHeight: 44)
            }
          } footer: {
            if let said { Text(said).foregroundStyle(.red) }
          }
          Section {
            LabeledContent("Server", value: held.server.host() ?? held.server.absoluteString)
          }
        }
      }
      .navigationTitle("You")
      .confirmationDialog("Sign out of Maslow?", isPresented: $leaving, titleVisibility: .visible) {
        Button("Sign out", role: .destructive) { Task { await signOut() } }
      } message: {
        Text("This phone's session ends on the server, so the token it holds is dead.")
      }
      .confirmationDialog(
        "Forget this session on this phone?", isPresented: $forgetting, titleVisibility: .visible
      ) {
        Button("Forget", role: .destructive) { session.close() }
      } message: {
        Text(
          "Maslow can't be reached, so the session cannot be ended there. Forgetting it signs this phone out and leaves that token live on the server."
        )
      }
      .sensoryFeedback(.success, trigger: session.org?.userId)
      .sensoryFeedback(.error, trigger: said) { _, said in said != nil }
    }
  }

  // Who the phone is: their initials, their name and their address.
  private func who(_ held: Session.Held) -> some View {
    HStack(spacing: 14) {
      Circle()
        .fill(.tint.secondary)
        .frame(width: 56, height: 56)
        .overlay { Text(Self.initials(of: held.person)).font(.title3.weight(.medium)) }
      VStack(alignment: .leading, spacing: 2) {
        Text(held.person).font(.headline)
        Text(held.email).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
  }

  // Every org the person is in, the one they are in marked, any other a tap
  // away.
  private func orgs(_ orgs: [Session.Org]) -> some View {
    ForEach(orgs) { org in
      Button {
        Task { await move(to: org) }
      } label: {
        LabeledContent(org.name) {
          if org.current { Image(systemName: "checkmark").foregroundStyle(.tint) }
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .frame(minHeight: 44)
      .disabled(busy)
      .accessibilityAddTraits(org.current ? .isSelected : [])
    }
  }

  private func move(to org: Session.Org) async {
    guard !org.current else { return }
    busy = true
    defer { busy = false }
    do {
      session.open(try await session.api.switchOrg(to: org.userId))
      said = nil
      stranded = false
    } catch {
      said = error.localizedDescription
    }
  }

  // The session ends on the server first, so a token that leaked from this
  // phone is dead; then the phone forgets it. A server that refuses is said
  // and the phone stays signed in, rather than forget a live token; a server
  // that cannot be reached is said and the way out stands beside it.
  // Every other browser's and phone's session ends; this one stays.
  private func signOutOthers() async {
    busy = true
    defer { busy = false }
    struct Ended: Decodable { var ended: Int }
    do {
      let e: Ended = try await session.api.post("/settings/devices", [:])
      said = e.ended == 0 ? "Nowhere else was signed in." : "Signed out everywhere else."
    } catch {
      said = error.localizedDescription
    }
  }

  private func signOut() async {
    busy = true
    defer { busy = false }
    do {
      await push.forget()
      try await session.api.signOut()
    } catch API.Failure.signedOut {
      // It was already gone.
    } catch {
      said = error.localizedDescription
      stranded = (error as? API.Failure) == .unreachable
      return
    }
    session.close()
  }

  // The one or two letters a person is shown by where there is no picture.
  private static func initials(of name: String) -> String {
    let words = name.split(separator: " ").prefix(2)
    let letters = words.compactMap(\.first).map(String.init).joined()
    return letters.isEmpty ? "?" : letters.uppercased()
  }
}
