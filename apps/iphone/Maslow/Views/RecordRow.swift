import SwiftUI

// One record in a list: its title, the first line of what it says, when it
// last changed, and whose it is where it is not the reader's.
struct RecordRow: View {
  let record: Stub
  var showType = false

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(record.title.isEmpty ? "Untitled" : record.title)
        .font(.headline)
        .lineLimit(2)
      if !record.opening.isEmpty {
        Text(record.opening)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      HStack(spacing: 8) {
        Text(record.updatedAt, format: .relative(presentation: .named))
        if showType { TypeMark(type: record.type) }
        if let owner = record.owner { Text(owner) }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

// A list of records that reads a page at a time, cut into the days they
// last changed.
struct RecordList: View {
  let records: [Stub]
  var showType = false
  var more: (() async -> Void)?

  private var days: [(day: Date, records: [Stub])] {
    let grouped = Dictionary(grouping: records) { Calendar.current.startOfDay(for: $0.updatedAt) }
    return grouped.keys.sorted(by: >).map { ($0, grouped[$0] ?? []) }
  }

  var body: some View {
    ForEach(days, id: \.day) { day in
      Section {
        ForEach(day.records) { record in
          NavigationLink(value: record.id) {
            RecordRow(record: record, showType: showType)
          }
          .task {
            if record.id == records.last?.id { await more?() }
          }
        }
      } header: {
        Text(day.day, format: .dateTime.weekday(.wide).month().day())
      }
    }
  }
}
