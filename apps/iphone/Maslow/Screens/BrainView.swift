import SwiftUI

// The brain: the person's types, each with how many records it holds, the
// types colleagues shared folded under their names, and the whole brain by
// its words as the field is typed in.
struct BrainView: View {
  @Environment(Session.self) private var session
  @Environment(\.scenePhase) private var phase
  @State private var loaded = Loaded<Vocabulary>.reading
  @State private var writing = false
  @State private var sharing: BrainType?
  @State private var refusals = 0
  @State private var query = ""

  private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

  var body: some View {
    NavigationStack {
      Group {
        if searching {
          SearchView(query: query)
        } else {
          switch loaded {
          case .reading:
            List { TypeRows(types: Vocabulary.placeholder.types) }
              .redacted(reason: .placeholder)
              .disabled(true)
          case .failed(let said):
            Failed(said: said) { await load() }
          case .ready(let v):
            if v.types.isEmpty {
              ContentUnavailableView(
                "Nothing here yet", systemImage: "brain",
                description: Text("Your agent writes what it concludes here."))
            } else {
              types(v)
            }
          }
        }
      }
      .searchable(text: $query, prompt: "Words, \"a phrase\", -not this")
      .navigationTitle("Brain")
      .navigationSubtitle(loaded.value.map { "\($0.records) records" } ?? "")
      .navigationDestination(for: BrainType.self) { RecordsView(type: $0) }
      .navigationDestination(for: String.self) { RecordView(id: $0) }
      .toolbar {
        if loaded.value != nil {
          ToolbarItem(placement: .primaryAction) {
            Button("New record", systemImage: "plus") { writing = true }
          }
        }
      }
      .sheet(isPresented: $writing) {
        NewRecord(types: loaded.value?.types.filter(\.own) ?? []) { _ in
          Task { await load() }
        }
      }
      .sheet(item: $sharing) { type in
        ShareSheet(type: type.id, what: type.name) {}
      }
      .sensoryFeedback(.error, trigger: refusals)
    }
    .task { await load() }
    .onChange(of: phase) { if phase == .active { Task { await load() } } }
  }

  private func types(_ v: Vocabulary) -> some View {
    let shared = Dictionary(grouping: v.types.filter { !$0.own }) { $0.owner ?? "A colleague" }
      .sorted { $0.key < $1.key }
    return List {
      Section {
        TypeRows(types: v.types.filter(\.own)) { sharing = $0 }
      }
      ForEach(shared, id: \.key) { owner, types in
        Section(owner) { TypeRows(types: types) }
      }
    }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      loaded = .ready(try await session.api.vocabulary())
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
}

private struct TypeRows: View {
  let types: [BrainType]
  var share: ((BrainType) -> Void)?

  var body: some View {
    ForEach(types) { type in
      NavigationLink(value: type) {
        LabeledContent(type.name) {
          Text(type.records, format: .number).monospacedDigit()
        }
      }
      .contextMenu {
        if let share {
          Button("Share this type", systemImage: "person.badge.plus") { share(type) }
        }
      }
    }
  }
}

extension Vocabulary {
  // Rows to redact while the real ones are read.
  static let placeholder = Vocabulary(
    records: 0,
    types: ["conversation", "person", "decision", "note", "task"].enumerated().map { i, name in
      BrainType(id: name, name: name, own: true, ownerId: "", owner: nil, records: 10 - i * 2, properties: [])
    })
}
