import SwiftUI

// What one file or folder of the person's own reaches: everyone in the
// org, or the groups and people ticked, at view or edit. Everything ticked
// is sent, so whoever is left off is taken off in the same act; nobody
// ticked ends the share. The link is the one its owner hands out.
struct FileShareSheet: View {
  let entry: FileEntry
  let again: () async -> Void
  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var loaded = Loaded<Sharing>.reading
  @State private var to = Reach()
  @State private var saving = false
  @State private var refused: String?
  @State private var saves = 0
  @State private var refusals = 0

  var body: some View {
    NavigationStack {
      Group {
        switch loaded {
        case .reading:
          ProgressView("Asking who this can go to…")
        case .failed(let said):
          Failed(said: said) { await load() }
        case .ready(let sharing):
          Form {
            Section {
              Toggle("Everyone in the org", isOn: $to.everyone)
              Picker("They may", selection: $to.level) {
                Text("View").tag("view")
                Text("Edit").tag("edit")
              }
              .pickerStyle(.segmented)
            } footer: {
              if let refused { Text(refused).foregroundStyle(.red) }
            }
            if !sharing.groups.isEmpty {
              Section("Groups") {
                ForEach(sharing.groups) { group in
                  Toggle(group.name, isOn: ticked($to.groupIds, group.id))
                }
              }
            }
            if !sharing.members.isEmpty {
              Section("People") {
                ForEach(sharing.members) { member in
                  Toggle(member.name, isOn: ticked($to.memberIds, member.id))
                }
              }
            }
            if let id = entry.sharedId {
              Section("Link") {
                ShareLink(item: session.api.server.appending(path: "/file/\(id)")) {
                  LabeledContent("Anyone allowed", value: "/file/\(id)")
                }
              }
            }
          }
        }
      }
      .navigationTitle(entry.name)
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") { Task { await save() } }
            .disabled(saving || loaded.value == nil)
        }
      }
      .sensoryFeedback(.success, trigger: saves)
      .sensoryFeedback(.error, trigger: refusals)
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
    .task { await load() }
  }

  // One party's tick, on or off the set it belongs to.
  private func ticked(_ ids: Binding<Set<String>>, _ id: String) -> Binding<Bool> {
    Binding(
      get: { ids.wrappedValue.contains(id) },
      set: { on in
        if on {
          ids.wrappedValue.insert(id)
        } else {
          ids.wrappedValue.remove(id)
        }
      })
  }

  private func load() async {
    do {
      let sharing = try await session.api.fileSharing()
      to = sharing.reach(of: entry.sharedId)
      loaded = .ready(sharing)
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      loaded = .failed(error.localizedDescription)
    }
  }

  private func save() async {
    saving = true
    refused = nil
    defer { saving = false }
    do {
      try await session.api.shareFile(at: entry.path, to: to)
      saves += 1
      await again()
      dismiss()
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      refused = error.localizedDescription
      refusals += 1
    }
  }
}
