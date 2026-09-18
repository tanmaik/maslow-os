import SwiftUI

// Searching the brain: every record the person can see, by its words,
// through the read door, as the Brain's own field is typed in.
struct SearchView: View {
  let query: String
  @Environment(Session.self) private var session
  @State private var page: Page?
  @State private var said: String?

  private var words: String { query.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    Group {
      if words.isEmpty {
        ContentUnavailableView(
          "Search your brain", systemImage: "magnifyingglass",
          description: Text("Every record you can see, by its words."))
      } else if let said {
        Failed(said: said) { await search() }
      } else if let page {
        if page.records.isEmpty {
          ContentUnavailableView.search(text: words)
        } else {
          List {
            RecordList(records: page.records, showType: true)
          }
          .listStyle(.plain)
        }
      } else {
        ProgressView()
      }
    }
    .task(id: query) { await search() }
  }

  // A read a quarter second after the last keystroke; the task carrying the
  // older query is cancelled before it asks.
  private func search() async {
    guard !words.isEmpty else {
      page = nil
      said = nil
      return
    }
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled else { return }
    said = nil
    do {
      page = try await session.api.records(query: words)
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
    }
  }
}
