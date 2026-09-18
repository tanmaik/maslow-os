import SwiftUI

// What this person has spent on models, in dollars: this week against the
// ceiling that is theirs, and the models that took it.
nonisolated struct Usage: Decodable, Sendable {
  nonisolated struct Model: Decodable, Identifiable, Sendable {
    var model: String
    var usd: Double
    var id: String { model }
  }

  var spentUsd: Double
  var capUsd: Double
  var resetsAt: String
  var models: [Model]

  var reached: Bool { spentUsd >= capUsd }
  var share: Double { capUsd > 0 ? min(spentUsd / capUsd, 1) : 0 }

  // When the weekly window turns over, as the server wrote it.
  var resets: Date? {
    let full = ISO8601DateFormatter()
    full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return full.date(from: resetsAt) ?? ISO8601DateFormatter().date(from: resetsAt)
  }
}

extension API {
  // The week's spend, or nothing when this deployment mints no model keys
  // and so has nothing of ours to meter.
  func usage() async throws -> Usage? {
    do {
      let usage: Usage = try await get("/usage")
      return usage
    } catch let failure as Failure where failure == .status(404) {
      return nil
    }
  }
}

// Claude Code: whose credentials it runs on, and the week's spend against
// the cap.
struct ClaudeCodePane: View {
  @Environment(Session.self) private var session
  @State private var state: Loaded<Usage?> = .reading
  // What a refresh could not do, while the figures already read stay up.
  @State private var said: String?

  var body: some View {
    Group {
      switch state {
      case .reading:
        ProgressView().controlSize(.large)
      case .failed(let said):
        Failed(said: said) { await read() }
      case .ready(let usage):
        if let usage { spend(usage) } else { off }
      }
    }
    .navigationTitle("Claude Code")
    .task {
      // The vendor's figure is a minute old at worst, so the pane asks
      // again while it is open and what was spent elsewhere lands here.
      while !Task.isCancelled {
        await read()
        try? await Task.sleep(for: .seconds(30))
      }
    }
  }

  private var off: some View {
    ContentUnavailableView {
      Label("Model keys are off here", systemImage: "key.slash")
    } description: {
      Text(
        "This deployment mints none, so the agent on a computer runs on credentials of your own and there is nothing of ours to meter."
      )
    }
  }

  private func spend(_ usage: Usage) -> some View {
    List {
      Section {
        LabeledContent("Spent") {
          Text(usage.spentUsd, format: .currency(code: "USD")).monospacedDigit()
        }
        LabeledContent("Cap") {
          Text(usage.capUsd, format: .currency(code: "USD")).monospacedDigit()
        }
        ProgressView(value: usage.share) {
          Text(usage.reached ? "Limit reached" : "\(Int(usage.share * 100))% used")
        }
        .tint(usage.reached ? Color.red : nil)
        if let resets = usage.resets {
          LabeledContent("Resets", value: resets.formatted(.dateTime.weekday().month().day()))
        }
      } header: {
        Text("This week")
      } footer: {
        VStack(alignment: .leading, spacing: 4) {
          Text(
            usage.reached
              ? "The calls stop until the week turns over; nothing else does."
              : "The cap is yours and weekly. Reaching it stops the calls and nothing else.")
          if let said { Text(said).foregroundStyle(.red) }
        }
      }
      Section {
        LabeledContent("Agent window", value: "Maslow's key")
        LabeledContent("claude in your terminal", value: "Your own account")
      } header: {
        Text("Whose credentials")
      } footer: {
        Text(
          "The Agent window runs on a key we mint for you and meter here. Signing `claude` in your terminal into your own Claude account is done in the terminal, and passes through nothing of ours."
        )
      }
      Section("Models") {
        if usage.models.isEmpty {
          Text("Nothing spent yet.").foregroundStyle(.secondary)
        } else {
          ForEach(usage.models) { model in
            LabeledContent(model.model) {
              Text(model.usd, format: .currency(code: "USD")).monospacedDigit()
            }
          }
        }
      }
    }
    .refreshable { await read() }
    .sensoryFeedback(.error, trigger: said) { _, said in said != nil }
  }

  // A first read that fails is the whole page; a later one keeps the
  // figures on screen and says what went wrong under them.
  private func read() async {
    do {
      state = .ready(try await session.api.usage())
      said = nil
    } catch {
      if state.value == nil {
        state = .failed(error.localizedDescription)
      } else {
        said = error.localizedDescription
      }
    }
  }
}
