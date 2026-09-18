import SwiftUI

// A record or a type opened to someone: a person, a group, or everyone in
// the org. A share on a type reaches every record of it. Nothing is chosen
// to begin with, since opening a record to the whole org is the most
// consequential act here and is never a default.
struct ShareSheet: View {
  var record: String?
  var type: String?
  let what: String
  let shared: () -> Void

  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var who: Who?
  @State private var subject = ""
  @State private var level = "view"
  @State private var sharing = false
  @State private var said: String?
  @State private var trouble: String?
  @State private var mishaps = 0

  // The three levels, in the words the brain uses for them everywhere.
  private static let levels = [("view", "view"), ("edit", "edit"), ("owner", "own")]

  var body: some View {
    NavigationStack {
      Form {
        if let who {
          Section("Share with") {
            Picker("Share with", selection: $subject) {
              Text("Nobody yet").tag("")
              ForEach(who.members.filter { !$0.me }) { m in
                Text(m.name).tag("member:\(m.id)")
              }
              ForEach(who.groups) { g in
                Text("\(g.name) (group)").tag("group:\(g.id)")
              }
              Text("Everyone in the org").tag("everyone")
            }
            .pickerStyle(.inline)
            .labelsHidden()
          }
          Section {
            Picker("Permission", selection: $level) {
              ForEach(Self.levels, id: \.0) { value, said in Text(said).tag(value) }
            }
            .disabled(subject == "everyone")
          } footer: {
            Text(
              "Everyone can only be given view. Editors can change; owners can also share, remove and merge."
            )
          }
        } else if let said {
          Failed(said: said) { await load() }
        } else {
          Section { ProgressView() }
        }
      }
      .navigationTitle("Share \(what)")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Share") { Task { await give() } }
            .disabled(subject.isEmpty || sharing)
        }
      }
      .alert(
        "Couldn't share it",
        isPresented: .init(get: { trouble != nil }, set: { if !$0 { trouble = nil } })
      ) {
        Button("OK") { trouble = nil }
      } message: {
        Text(trouble ?? "")
      }
      .sensoryFeedback(.error, trigger: mishaps)
      .task { await load() }
      .onChange(of: subject) { if subject == "everyone" { level = "view" } }
    }
    .presentationDetents([.medium, .large])
  }

  private func load() async {
    do {
      who = try await session.api.who()
      said = nil
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
    }
  }

  private func give() async {
    sharing = true
    defer { sharing = false }
    do {
      try await session.api.share(record: record, type: type, with: subject, at: level)
      shared()
      dismiss()
    } catch Refusal.signedOut {
      session.close()
    } catch {
      trouble = error.localizedDescription
      mishaps += 1
    }
  }
}
