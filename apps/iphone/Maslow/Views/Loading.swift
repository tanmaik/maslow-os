import SwiftUI

// What a page holds while it reads, once it has read, or when it could not.
nonisolated enum Loaded<T: Sendable>: Sendable {
  case reading
  case ready(T)
  case failed(String)

  var value: T? {
    if case .ready(let v) = self { return v }
    return nil
  }
}

// A page's error, said plainly, with a way to try again.
struct Failed: View {
  let said: String
  let retry: () async -> Void

  var body: some View {
    ContentUnavailableView {
      Label("Couldn't load", systemImage: "wifi.exclamationmark")
    } description: {
      Text(said)
    } actions: {
      Button("Try again") { Task { await retry() } }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }
  }
}
