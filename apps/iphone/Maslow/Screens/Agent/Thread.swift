import SwiftUI

// The conversation as it reads: what was said, each on its own; what the
// agent thought, folded; a row for every step it took, opening onto what
// the step did; the plan it is working to; and what it asks before it
// acts, answered where it stands. It follows its newest line.
struct ThreadView: View {
  let chat: Chat
  let wrote: [String: TerminalSaid]
  let onAllow: (Ask, PermissionOption) -> Void
  let onAnswer: (Ask, String) -> Void

  @State private var showing: ToolCall?
  @State private var position = ScrollPosition(edge: .bottom)
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        ForEach(chat.items) { item in
          switch item.kind {
          case .said(let person, let text):
            if person {
              Text(text)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(.fill.tertiary, in: .rect(corners: .concentric(minimum: 18), isUniform: true))
                .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
              MarkdownView(text)
            }
          case .thought(let text):
            Thought(text: text)
          case .tool(let call, let under):
            Step(call: call, terminal: terminal(of: call)) { showing = call }
              .padding(.leading, under == nil ? 0 : 16)
          case .plan(let entries):
            PlanBlock(entries: entries)
          }
        }
        if chat.running, waiting {
          Label("Thinking", systemImage: "sparkles")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .symbolEffect(.variableColor, isActive: !reduceMotion)
        } else if silent {
          Label("Your agent said nothing", systemImage: "exclamationmark.circle")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        ForEach(chat.asks) { ask in
          AskCard(
            ask: ask, onAllow: { onAllow(ask, $0) }, onAnswer: { onAnswer(ask, $0) })
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
    }
    .scrollPosition($position)
    .defaultScrollAnchor(.bottom)
    .scrollDismissesKeyboard(.interactively)
    .onChange(of: newest) {
      withAnimation(reduceMotion ? .smooth(duration: 0.2) : .snappy) {
        position.scrollTo(edge: .bottom)
      }
    }
    .sheet(item: $showing) { call in
      NavigationStack {
        ShownStep(call: call, terminal: terminal(of: call))
          .navigationTitle(call.said)
          .navigationBarTitleDisplayMode(.inline)
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }

  // Whether the agent has yet to say anything in the turn it is at.
  private var waiting: Bool {
    guard let last = chat.items.last else { return true }
    if case .said(true, _) = last.kind { return true }
    if case .said(false, _) = last.kind { return false }
    return true
  }

  // A turn that ended with the person's words still last: the agent
  // answered with nothing at all, and the silence is said rather than
  // left as an empty thread.
  private var silent: Bool {
    guard !chat.running, chat.asks.isEmpty, let last = chat.items.last else { return false }
    if case .said(true, _) = last.kind { return true }
    return false
  }

  // What has changed at the foot of the thread, which is what the view
  // follows: the newest words, the steps, and what is being asked.
  private var newest: String {
    var said = "\(chat.items.count)/\(chat.asks.count)/\(chat.running)"
    if case .said(_, let text) = chat.items.last?.kind { said += "/\(text.count)" }
    if case .tool(let call, _) = chat.items.last?.kind {
      said += "/\(call.status.rawValue)/\(wrote[terminalId(of: call) ?? ""]?.output.count ?? 0)"
    }
    return said
  }

  private func terminalId(of call: ToolCall) -> String? {
    call.content.first { $0.type == "terminal" }?.terminalId
  }

  // The terminal a step's command runs in, where it has one.
  private func terminal(of call: ToolCall) -> TerminalSaid? {
    terminalId(of: call).flatMap { wrote[$0] }
  }
}

// What the agent thought, folded away: one line that opens onto the words.
private struct Thought: View {
  let text: String
  @State private var open = false

  var body: some View {
    DisclosureGroup("Thought", isExpanded: $open) {
      Text(text)
        .font(.subheadline)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }
    .font(.subheadline)
    .foregroundStyle(.secondary)
  }
}

// One step the agent took: how it is going, what it is, and a way onto
// what it did where there is something to see.
private struct Step: View {
  let call: ToolCall
  let terminal: TerminalSaid?
  let onShow: () -> Void

  var body: some View {
    Button(action: onShow) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        mark
        Text(call.said + (terminal?.how ?? ""))
          .font(.subheadline)
          .foregroundStyle(call.status == .failed ? .red : .secondary)
          .multilineTextAlignment(.leading)
        Spacer(minLength: 0)
        if more {
          Image(systemName: "chevron.right")
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
      }
      .frame(minHeight: 36)
      .padding(.vertical, 4)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(!more)
  }

  @ViewBuilder private var mark: some View {
    switch call.status {
    case .completed:
      Image(systemName: "checkmark").font(.caption).foregroundStyle(.tertiary)
    case .failed:
      Image(systemName: "xmark").font(.caption).foregroundStyle(.red)
    case .inProgress:
      ProgressView().controlSize(.mini)
    case .pending:
      Image(systemName: call.kind.mark).font(.caption).foregroundStyle(.tertiary)
    }
  }

  // Whether the step has anything to open onto: what it printed, or what
  // it put in a file.
  private var more: Bool {
    if terminal?.output.isEmpty == false { return true }
    return call.content.contains { $0.type == "diff" || $0.content?.words.isEmpty == false }
  }
}

// What Claude Code means to do next, as a list that changes in place.
private struct PlanBlock: View {
  let entries: [PlanEntry]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Plan \(entries.filter(\.done).count)/\(entries.count)")
        .font(.caption)
        .foregroundStyle(.tertiary)
      ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Image(
            systemName: entry.done
              ? "checkmark.circle.fill" : entry.going ? "circle.dotted" : "circle")
            .font(.caption)
            .foregroundStyle(entry.going ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
          Text(entry.content)
            .font(.subheadline)
            .strikethrough(entry.done)
            .foregroundStyle(entry.done ? .tertiary : .secondary)
        }
      }
    }
  }
}

// What the agent asks before it acts, and a question it asks the person:
// what kind of thing in plain words, the thing itself as it would run, and
// the answers as buttons. It blocks nothing — the rest of the transcript
// keeps arriving under it.
private struct AskCard: View {
  let ask: Ask
  let onAllow: (PermissionOption) -> Void
  let onAnswer: (String) -> Void
  @State private var typed = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Label(
        ask.asked == nil ? ask.kind.asking : ask.title,
        systemImage: ask.asked == nil ? ask.kind.mark : "questionmark.bubble")
        .font(.headline)
      if let asked = ask.asked {
        if !asked.body.isEmpty {
          Text(plain(asked.body))
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        ForEach(asked.choices, id: \.self) { choice in
          Button(choice) { onAnswer(choice) }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .buttonSizing(.flexible)
        }
        if asked.choices.isEmpty {
          HStack {
            TextField("Your answer", text: $typed, axis: .vertical)
              .textFieldStyle(.roundedBorder)
            Button("Answer", systemImage: "arrow.up") {
              let said = typed.trimmingCharacters(in: .whitespacesAndNewlines)
              typed = ""
              if !said.isEmpty { onAnswer(said) }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderedProminent)
            .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      } else {
        Text(what)
          .font(.footnote.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(4)
        HStack {
          ForEach(ask.options) { option in
            if option.kind == "allow_once" {
              Button(option.said) { onAllow(option) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            } else {
              Button(option.said) { onAllow(option) }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
          }
        }
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      .fill.quinary, in: .rect(corners: .concentric(minimum: 16), isUniform: true))
  }

  // The options' own descriptions, which the door sends as a list.
  private func plain(_ body: String) -> String {
    body.split(separator: "\n", omittingEmptySubsequences: false)
      .map { $0.hasPrefix("- ") ? String($0.dropFirst(2)) : String($0) }
      .joined(separator: "\n")
  }

  // The thing itself, without the backticks Claude Code wraps a command in.
  private var what: String {
    ask.title.trimmingCharacters(in: CharacterSet(charactersIn: "` "))
  }
}

// What a step did, whole: what the command printed, what an edit put in a
// file, what a tool said back.
private struct ShownStep: View {
  let call: ToolCall
  let terminal: TerminalSaid?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        ForEach(Array(call.content.enumerated()), id: \.offset) { _, piece in
          if piece.type == "diff" {
            VStack(alignment: .leading, spacing: 4) {
              Text(piece.path ?? "").font(.caption).foregroundStyle(.tertiary)
              Block(text: piece.newText ?? "")
            }
          } else if let words = piece.content?.words, !words.isEmpty {
            Block(text: words)
          }
        }
        if let output = terminal?.output, !output.isEmpty {
          Block(text: output)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
    }
  }
}

private struct Block: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption.monospaced())
      .foregroundStyle(.secondary)
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(10)
      .background(.fill.quaternary, in: .rect(corners: .concentric(minimum: 10), isUniform: true))
  }
}
