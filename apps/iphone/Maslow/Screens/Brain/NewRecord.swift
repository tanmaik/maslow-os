import SwiftUI

// A record written by hand: of one of the person's types, with the fields
// that type declares, or of a type made up here, each of whose fields is
// declared and filled in in the same breath. The write door refuses a
// record of a type nobody defined, so a new type is defined in the same
// call that writes its first record.
struct NewRecord: View {
  let types: [BrainType]
  var type: BrainType?
  let written: (String) -> Void

  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var chosen = ""
  @State private var made = ""
  @State private var title = ""
  @State private var typed = ""
  @State private var values: [String: String] = [:]
  @State private var declaring: [NewField] = []
  @State private var writing = false
  @State private var said: String?
  @State private var mishaps = 0

  // What a field can hold, in the word a person picks it by.
  private static let kinds: [(String, String)] = [
    ("text", "Text"), ("number", "Number"), ("boolean", "Yes/no"), ("date", "Date"),
    ("datetime", "Date & time"), ("enum", "Choice"), ("list", "List"),
  ]

  private var fresh: Bool { type == nil && chosen.isEmpty }
  private var name: String { type?.name ?? (fresh ? made.trimmingCharacters(in: .whitespaces) : chosen) }
  private var declared: [Property] {
    type?.properties ?? types.first { $0.name == chosen }?.properties ?? []
  }
  private var ready: Bool {
    !title.trimmingCharacters(in: .whitespaces).isEmpty && !name.isEmpty && !writing
  }

  var body: some View {
    NavigationStack {
      Form {
        if type == nil { picker }
        Section {
          TextField("Title", text: $title)
            .submitLabel(.next)
        }
        Section("Body") {
          TextEditor(text: $typed)
            .frame(minHeight: 120)
        }
        if fresh {
          fields
        } else if !declared.isEmpty {
          Section("Fields") {
            ForEach(declared, id: \.name) { p in
              FieldEntry(
                name: Field.said(p.name), datatype: p.datatype, options: p.options ?? [],
                value: value(p.name))
            }
          }
        }
      }
      .navigationTitle(type.map { "New \($0.name)" } ?? "New record")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add") { Task { await write() } }
            .disabled(!ready)
        }
      }
      .alert("Couldn't write it", isPresented: .init(get: { said != nil }, set: { if !$0 { said = nil } })) {
        Button("OK") { said = nil }
      } message: {
        Text(said ?? "")
      }
      .sensoryFeedback(.error, trigger: mishaps)
      .disabled(writing)
    }
    .onAppear {
      if chosen.isEmpty, type == nil {
        chosen = types.first { $0.name == "note" }?.name ?? types.first?.name ?? ""
      }
    }
  }

  // The type this record is of: one of the person's own, or something new.
  private var picker: some View {
    Section {
      Picker("Type", selection: $chosen) {
        ForEach(types) { t in Text(t.name).tag(t.name) }
        Text("Something new…").tag("")
      }
      if fresh {
        TextField("Type name", text: $made)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
    }
  }

  // The fields a type being made up declares, each named and given a kind.
  private var fields: some View {
    Section("Fields") {
      ForEach($declaring) { $field in
        VStack(alignment: .leading, spacing: 8) {
          TextField("Field name", text: $field.label)
          Picker("Holds", selection: $field.datatype) {
            ForEach(Self.kinds, id: \.0) { kind, said in Text(said).tag(kind) }
          }
          if field.datatype == "enum" {
            TextField("Options, separated by commas", text: $field.options)
          }
          if !field.name.isEmpty {
            FieldEntry(
              name: Field.said(field.name), datatype: field.datatype,
              options: field.options.split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces)
              },
              value: value(field.name))
          }
        }
      }
      .onDelete { declaring.remove(atOffsets: $0) }
      Button("Add a field", systemImage: "plus") { declaring.append(NewField()) }
    }
  }

  private func value(_ name: String) -> Binding<String> {
    Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
  }

  private func write() async {
    writing = true
    defer { writing = false }
    do {
      let id = try await session.api.write(
        type: name, fresh: fresh, title: title.trimmingCharacters(in: .whitespaces),
        body: typed, values: values.filter { !$0.value.isEmpty }, declaring: declaring)
      written(id)
      dismiss()
    } catch Refusal.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
      mishaps += 1
    }
  }
}
