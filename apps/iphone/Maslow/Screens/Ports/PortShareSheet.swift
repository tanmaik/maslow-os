import SwiftUI

// Sharing one port: everyone in the org, or the people and groups picked
// here, at view and no other level. Whoever is left off is taken off when
// this is saved, and Stop sharing takes everybody off.
struct PortShareSheet: View {
  let port: Int
  let sharing: PortSharing?
  let save: (PortReach) async -> String?

  @Environment(\.dismiss) private var dismiss
  @State private var reach = PortReach()
  @State private var said: String?
  @State private var saving = false
  @State private var landed: Bool?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Toggle("Everyone in the org", isOn: $reach.everyone)
        } footer: {
          Text("Whoever you pick opens this port while signed in to Maslow. For everybody else the address is not there at all.")
        }
        if let sharing, !sharing.members.isEmpty {
          Section("People") {
            ForEach(sharing.members) { member in
              Pick(name: member.name, on: reach.memberIds.contains(member.id)) {
                toggle(member.id, in: \.memberIds)
              }
            }
          }
          .disabled(reach.everyone)
        }
        if let sharing, !sharing.groups.isEmpty {
          Section("Groups") {
            ForEach(sharing.groups) { group in
              Pick(name: group.name, on: reach.groupIds.contains(group.id)) {
                toggle(group.id, in: \.groupIds)
              }
            }
          }
          .disabled(reach.everyone)
        }
        if sharing == nil {
          Section {
            Text("Who you could name isn't there: this server doesn't answer who is in your org yet. Everyone in the org still works.")
              .foregroundStyle(.secondary)
          }
        }
        if let said {
          Section { Text(said).foregroundStyle(.red) }
        }
        if sharing?.reach(of: port).isShared == true {
          Section {
            Button("Stop sharing", role: .destructive) { store(PortReach()) }
              .disabled(saving)
          }
        }
      }
      .navigationTitle("Share port \(port)")
      .navigationSubtitle("At view")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") { store(reach) }
            .disabled(saving)
        }
      }
      .sensoryFeedback(trigger: landed) { _, landed in landed == true ? .success : .error }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
    .onAppear { reach = sharing?.reach(of: port) ?? PortReach() }
  }

  private func toggle(_ id: String, in ids: WritableKeyPath<PortReach, Set<String>>) {
    if reach[keyPath: ids].contains(id) {
      reach[keyPath: ids].remove(id)
    } else {
      reach[keyPath: ids].insert(id)
    }
  }

  private func store(_ wanted: PortReach) {
    saving = true
    Task {
      let why = await save(wanted)
      saving = false
      said = why
      landed = why == nil
      if why == nil { dismiss() }
    }
  }
}

// One person or group, on or off.
private struct Pick: View {
  let name: String
  let on: Bool
  let tap: () -> Void

  var body: some View {
    Button(action: tap) {
      LabeledContent {
        if on { Image(systemName: "checkmark").foregroundStyle(.tint) }
      } label: {
        Text(name).foregroundStyle(.primary)
      }
    }
    .accessibilityAddTraits(on ? [.isSelected] : [])
  }
}
