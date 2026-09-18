import SwiftUI

// How a list of records is narrowed and ordered: a condition on a field the
// type declares or on when the record was last changed, as many as the
// person sets, and a sort. The read door checks every condition against the
// field's own declaration; nothing narrows here.

// When a record was last changed is not a declared field and never can be.
// This is the name it goes by in a condition and a sort.
nonisolated let MODIFIED = "modified"

// One condition, as the read door takes it.
nonisolated struct Term: Identifiable, Hashable, Sendable {
  var property: String
  var op: String
  var value: String

  var id: String { param }
  var param: String { op == "unset" ? "\(property):unset" : "\(property):\(op):\(value)" }
}

// What the list is ordered by: a declared field, or when it was changed.
nonisolated struct Sorted: Hashable, Sendable {
  var property: String?
  var ascending = false

  var said: String {
    let name = property.map(Field.said) ?? "Modified"
    return ascending ? "\(name), oldest first" : "\(name), newest first"
  }
}

// A field as a condition reads it: what it is called and what it holds.
nonisolated enum Field {
  // The comparisons each kind of field offers, in the order they are shown.
  static func comparisons(_ datatype: String) -> [String] {
    switch datatype {
    case "number": ["eq", "gte", "lte", "unset"]
    case "boolean": ["eq", "unset"]
    case "date", "datetime": ["gte", "lt", "unset"]
    case "enum": ["eq", "unset"]
    case "list": ["contains", "unset"]
    case "when": ["gte", "lt"]
    default: ["contains", "eq", "unset"]
    }
  }

  // What a comparison is called, in the words the kind of field asks for.
  static func word(_ datatype: String, _ op: String) -> String {
    switch (datatype, op) {
    case ("number", "gte"): "at least"
    case ("number", "lte"): "at most"
    case ("date", "gte"), ("datetime", "gte"), ("when", "gte"): "on or after"
    case ("date", "lt"), ("datetime", "lt"), ("when", "lt"): "before"
    default:
      switch op {
      case "eq": "is"
      case "ne": "is not"
      case "lt": "before"
      case "lte": "up to"
      case "gt": "after"
      case "gte": "at least"
      case "in": "is any of"
      case "contains": "contains"
      default: "is empty"
      }
    }
  }

  // A field's name as a person reads it.
  static func said(_ name: String) -> String {
    name == MODIFIED ? "Modified" : name.replacingOccurrences(of: "_", with: " ").capitalized
  }
}

// One condition as a person reads it on its chip.
extension Term {
  func said(_ properties: [Property]) -> String {
    let datatype =
      property == MODIFIED ? "when" : (properties.first { $0.name == property }?.datatype ?? "text")
    let word = Field.word(datatype, op)
    if op == "unset" { return "\(Field.said(property)) \(word)" }
    return "\(Field.said(property)) \(word) \(value)"
  }
}

// The conditions in force, each a chip the person can take off, in a row
// that scrolls sideways under the list's title.
struct FilterChips: View {
  @Binding var terms: [Term]
  let properties: [Property]

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(terms) { term in
          Button {
            terms.removeAll { $0.id == term.id }
          } label: {
            HStack(spacing: 4) {
              Text(term.said(properties))
              Image(systemName: "xmark")
                .imageScale(.small)
            }
            .font(.subheadline)
            .frame(minHeight: 30)
          }
          .buttonStyle(.bordered)
          .buttonBorderShape(.capsule)
          .accessibilityLabel("Drop the condition \(term.said(properties))")
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 6)
    }
    .scrollIndicators(.hidden)
  }
}

// A condition being set: the field, the comparison and what it is compared
// against, checked as it is typed so nothing half-set is sent.
struct ConditionSheet: View {
  let properties: [Property]
  let add: (Term) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var property = MODIFIED
  @State private var op = "gte"
  @State private var value = ""

  private var datatype: String {
    property == MODIFIED ? "when" : (properties.first { $0.name == property }?.datatype ?? "text")
  }
  private var options: [String] {
    properties.first { $0.name == property }?.options ?? []
  }
  private var ready: Bool {
    op == "unset" || !value.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Field", selection: $property) {
            Text("Modified").tag(MODIFIED)
            ForEach(properties, id: \.name) { p in
              Text(Field.said(p.name)).tag(p.name)
            }
          }
          Picker("Is", selection: $op) {
            ForEach(Field.comparisons(datatype), id: \.self) { op in
              Text(Field.word(datatype, op)).tag(op)
            }
          }
          if op != "unset" {
            FieldEntry(
              name: "Value", datatype: datatype == "when" ? "datetime" : datatype,
              options: options, value: $value)
          }
        }
      }
      .navigationTitle("Condition")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add") {
            add(Term(property: property, op: op, value: value.trimmingCharacters(in: .whitespaces)))
            dismiss()
          }
          .disabled(!ready)
        }
      }
      .onChange(of: property) {
        op = Field.comparisons(datatype).first ?? "eq"
        value = ""
      }
    }
    .presentationDetents([.medium, .large])
  }
}
