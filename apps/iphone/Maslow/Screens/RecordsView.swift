import SwiftUI

// One type's records, a page at a time, cut into the days they happened,
// narrowed by the conditions the person set and ordered as they asked. A
// new record of this type is written from the bar.
struct RecordsView: View {
  let type: BrainType
  @Environment(Session.self) private var session
  @Environment(\.scenePhase) private var phase
  @State private var loaded = Loaded<Page>.reading
  @State private var terms: [Term] = []
  @State private var sort = Sorted()
  @State private var adding = false
  @State private var writing = false
  @State private var sharing = false
  @State private var reading = false
  @State private var refusals = 0

  // What the list is asking for, so a changed condition is a fresh read.
  private var asking: String {
    "\(terms.map(\.param).joined(separator: "\n"))|\(sort.property ?? "")|\(sort.ascending)"
  }

  var body: some View {
    Group {
      switch loaded {
      case .reading:
        List { RecordList(records: Page.placeholder.records) }
          .listStyle(.plain)
          .redacted(reason: .placeholder)
          .disabled(true)
      case .failed(let said):
        Failed(said: said) { await load() }
      case .ready(let page):
        if page.records.isEmpty {
          ContentUnavailableView(
            terms.isEmpty ? "No \(type.name) records" : "Nothing matches",
            systemImage: "tray",
            description: Text(
              terms.isEmpty
                ? "Write the first one from the bar." : "Take a condition off to see more."))
        } else {
          List {
            RecordList(records: page.records) { await more() }
            if page.cursor != nil {
              ProgressView()
                .frame(maxWidth: .infinity)
                .listRowSeparator(.hidden)
            }
          }
          .listStyle(.plain)
          .refreshable { await load() }
        }
      }
    }
    .safeAreaInset(edge: .top) {
      if !terms.isEmpty {
        FilterChips(terms: $terms, properties: type.properties)
      }
    }
    .navigationTitle(type.name)
    .navigationSubtitle(type.own ? "" : type.owner ?? "")
    .toolbarTitleDisplayMode(.inline)
    .toolbarVisibility(.hidden, for: .tabBar)
    .toolbar {
      if type.own {
        ToolbarItem(placement: .primaryAction) {
          Button("New \(type.name)", systemImage: "plus") { writing = true }
        }
      }
      ToolbarItem(placement: .bottomBar) {
        Menu("Filter", systemImage: "line.3.horizontal.decrease") {
          Button("Add a condition", systemImage: "plus") { adding = true }
          if !terms.isEmpty {
            Button("Take them all off", systemImage: "xmark") { terms = [] }
          }
          Section("Sort") {
            Picker("Sort", selection: $sort) {
              Text("Newest first").tag(Sorted(property: nil, ascending: false))
              Text("Oldest first").tag(Sorted(property: nil, ascending: true))
              ForEach(type.properties, id: \.name) { p in
                Text("\(Field.said(p.name)), first to last")
                  .tag(Sorted(property: p.name, ascending: true))
                Text("\(Field.said(p.name)), last to first")
                  .tag(Sorted(property: p.name, ascending: false))
              }
            }
          }
          if type.own {
            Button("Share this type", systemImage: "person.badge.plus") { sharing = true }
          }
        }
      }
      ToolbarItem(placement: .bottomBar) {
        Text(sort.said)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .sheet(isPresented: $adding) {
      ConditionSheet(properties: type.properties) { term in
        if !terms.contains(where: { $0.id == term.id }) { terms.append(term) }
      }
    }
    .sheet(isPresented: $writing) {
      NewRecord(types: [type], type: type) { _ in Task { await load() } }
    }
    .sheet(isPresented: $sharing) {
      ShareSheet(type: type.id, what: type.name) {}
    }
    .sensoryFeedback(.error, trigger: refusals)
    .task(id: asking) { await load() }
    .onChange(of: phase) { if phase == .active { Task { await load() } } }
  }

  private func load() async {
    do {
      loaded = .ready(
        try await session.api.records(
          type: type.name, owner: type.ownerId, terms: terms, sort: sort))
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      if loaded.value == nil {
        loaded = .failed(error.localizedDescription)
      } else {
        refusals += 1
      }
    }
  }

  private func more() async {
    guard case .ready(var page) = loaded, let cursor = page.cursor, !reading else { return }
    reading = true
    defer { reading = false }
    if let next = try? await session.api.records(
      type: type.name, owner: type.ownerId, terms: terms, sort: sort, cursor: cursor)
    {
      page.records += next.records
      page.cursor = next.cursor
      loaded = .ready(page)
    }
  }
}

extension Page {
  static let placeholder = Page(
    cursor: nil,
    records: (0..<8).map { i in
      Stub(
        id: "\(i)", type: "note", title: "A record that is being read",
        opening: "The first line of what it says",
        updatedAt: Date.now.addingTimeInterval(-Double(i) * 40_000), ownerId: "", owner: nil)
    })
}
