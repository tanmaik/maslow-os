import SwiftUI

// One value as the doors take it: whatever a declared field holds, entered
// the way the phone enters that kind of thing, and carried as the text the
// form posts.
struct FieldEntry: View {
  let name: String
  let datatype: String
  var options: [String] = []
  @Binding var value: String
  @State private var at = Date.now

  var body: some View {
    switch datatype {
    case "number":
      LabeledContent(name) {
        TextField(name, text: $value)
          .keyboardType(.numbersAndPunctuation)
          .multilineTextAlignment(.trailing)
      }
    case "boolean":
      Toggle(
        name,
        isOn: Binding(get: { value == "true" }, set: { value = $0 ? "true" : "false" }))
    case "date", "datetime":
      DatePicker(
        name, selection: $at,
        displayedComponents: datatype == "date" ? [.date] : [.date, .hourAndMinute])
        .onChange(of: at) { value = Self.text(at, datatype) }
        .onAppear {
          if let parsed = Self.date(value) { at = parsed } else { value = Self.text(at, datatype) }
        }
    case "enum":
      Picker(name, selection: $value) {
        Text("Any").tag("")
        ForEach(options, id: \.self) { Text($0).tag($0) }
      }
    case "list":
      LabeledContent(name) {
        TextField("Separated by commas", text: $value)
          .multilineTextAlignment(.trailing)
      }
    default:
      LabeledContent(name) {
        TextField(name, text: $value)
          .multilineTextAlignment(.trailing)
      }
    }
  }

  // A day as the database reads it, and a moment as the whole instant.
  private nonisolated static func text(_ at: Date, _ datatype: String) -> String {
    datatype == "date"
      ? at.formatted(.iso8601.year().month().day().dateSeparator(.dash))
      : at.formatted(.iso8601)
  }

  private nonisolated static func date(_ text: String) -> Date? {
    if let at = try? Date(text, strategy: .iso8601) { return at }
    return try? Date(text, strategy: .iso8601.year().month().day().dateSeparator(.dash))
  }
}
