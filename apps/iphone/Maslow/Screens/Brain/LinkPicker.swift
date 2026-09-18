import SwiftUI

// A new link from or to this record: a link is a sentence — this record, a
// verb, another record. The other record is found by its words through the
// picker door, which offers a handful and never the whole brain.
struct LinkPicker: View {
  let id: String
  let type: String
  let linked: () -> Void

  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var out = true
  @State private var verb = ""
  @State private var words = ""
  @State private var found: [Ref] = []
  @State private var other: Ref?
  @State private var linking = false
  @State private var said: String?
  @State private var mishaps = 0

  private var ready: Bool {
    other != nil && !verb.trimmingCharacters(in: .whitespaces).isEmpty && !linking
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Direction", selection: $out) {
            Text("this \(type) … the other").tag(true)
            Text("the other … this \(type)").tag(false)
          }
          TextField("Verb", text: $verb)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        Section("Record") {
          if let other {
            HStack(spacing: 8) {
              TypeDot(type: other.type)
              Text(other.title.isEmpty ? "Untitled" : other.title)
              Spacer()
              Button("Change") { self.other = nil }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            }
          } else if found.isEmpty {
            ContentUnavailableView(
              "Find a record", systemImage: "magnifyingglass",
              description: Text("Type what it is about."))
          } else {
            ForEach(found) { ref in
              Button {
                other = ref
                words = ""
              } label: {
                HStack(spacing: 8) {
                  TypeDot(type: ref.type)
                  Text(ref.title.isEmpty ? "Untitled" : ref.title)
                    .lineLimit(2)
                }
              }
            }
          }
        }
      }
      .searchable(text: $words, prompt: "Another record")
      .navigationTitle("Link")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Link") { Task { await link() } }
            .disabled(!ready)
        }
      }
      .alert(
        "Couldn't link it",
        isPresented: .init(get: { said != nil }, set: { if !$0 { said = nil } })
      ) {
        Button("OK") { said = nil }
      } message: {
        Text(said ?? "")
      }
      .sensoryFeedback(.error, trigger: mishaps)
      .task(id: words) { await search() }
    }
  }

  private func search() async {
    guard other == nil else { return }
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled else { return }
    found = (try? await session.api.pick(words.trimmingCharacters(in: .whitespaces), not: id)) ?? []
  }

  private func link() async {
    guard let other else { return }
    linking = true
    defer { linking = false }
    do {
      try await session.api.link(
        id, to: other.id, verb: verb.trimmingCharacters(in: .whitespaces), out: out)
      linked()
      dismiss()
    } catch Refusal.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
      mishaps += 1
    }
  }
}
