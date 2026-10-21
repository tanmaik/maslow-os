import Foundation

// The Agent Client Protocol as the phone speaks it: what Claude Code says
// down the door's socket while it works, the door's own words beside it,
// and the transcript those words build.

// A piece of what was said or handed over: text, a picture, a file of
// theirs carried along with the words.
nonisolated struct Spoken: Decodable, Sendable {
  var type: String
  var text: String?
  var name: String?
  var resource: Resource?

  nonisolated struct Resource: Decodable, Sendable {
    var uri: String?
    var text: String?
  }

  // What the piece reads as: a picture is a word for none, since the
  // transcript is written and not drawn.
  var words: String {
    switch type {
    case "text": text ?? ""
    case "resource": resource?.text ?? ""
    case "resource_link": name ?? ""
    default: ""
    }
  }
}

// What a tool call is doing, which decides how its row reads.
nonisolated enum ToolKind: String, Decodable, Sendable {
  case read, edit, delete, move, search, execute, think, fetch, other
  case switchMode = "switch_mode"

  init(from decoder: any Decoder) throws {
    let said = try decoder.singleValueContainer().decode(String.self)
    self = ToolKind(rawValue: said) ?? .other
  }

  // What the agent is asking leave to do, in the person's words.
  var asking: String {
    switch self {
    case .read: "Read a file?"
    case .edit: "Change a file?"
    case .delete: "Delete a file?"
    case .move: "Move a file?"
    case .search: "Search the files?"
    case .execute: "Run this command?"
    case .think: "Go on?"
    case .fetch: "Fetch a page?"
    case .switchMode: "Change how it acts?"
    case .other: "Use this tool?"
    }
  }

  var mark: String {
    switch self {
    case .read, .search: "doc.text"
    case .edit, .delete, .move: "pencil"
    case .execute: "terminal"
    case .think: "lightbulb"
    case .fetch: "globe"
    case .switchMode, .other: "wrench.and.screwdriver"
    }
  }
}

nonisolated enum ToolStatus: String, Decodable, Sendable {
  case pending, completed, failed
  case inProgress = "in_progress"

  init(from decoder: any Decoder) throws {
    let said = try decoder.singleValueContainer().decode(String.self)
    self = ToolStatus(rawValue: said) ?? .pending
  }
}

// What a tool call has to show: what it said, a change to a file, or a
// terminal of the agent's, whose output the door streams.
nonisolated struct ToolContent: Decodable, Sendable {
  var type: String
  var content: Spoken?
  var path: String?
  var oldText: String?
  var newText: String?
  var terminalId: String?
}

nonisolated struct ToolCall: Identifiable, Sendable {
  var id: String { toolCallId }
  var toolCallId: String
  var title: String
  var kind: ToolKind
  var status: ToolStatus
  var content: [ToolContent]
  // What Claude Code calls the tool, which says where the work is done:
  // its own hand, or a tool of an MCP server on the machine.
  var toolName: String?

  // What the row reads as: the adapter's plain name where the title is
  // only the tool's own, and a server's tool as brain › search.
  var said: String {
    var title = self.title
    if let toolName, title == toolName { title = ToolCall.plain[toolName] ?? title }
    if title.hasPrefix("mcp__") {
      let parts = title.dropFirst(5).components(separatedBy: "__")
      if parts.count == 2 { title = "\(parts[0]) › \(parts[1])" }
    }
    return title
  }

  private static let plain = [
    "Task": "A subagent",
    "Skill": "Using a skill",
    "SlashCommand": "Running a command",
    "AskUserQuestion": "Asking you",
    "EnterPlanMode": "Planning",
    "NotebookEdit": "Editing a notebook",
  ]
}

nonisolated struct PlanEntry: Decodable, Sendable {
  var content: String
  var status: String

  var done: Bool { status == "completed" }
  var going: Bool { status == "in_progress" }
}

nonisolated struct AgentMode: Decodable, Identifiable, Sendable {
  var id: String
  var name: String
  var description: String?
}

nonisolated struct AgentCommand: Decodable, Identifiable, Sendable {
  var name: String
  var description: String?
  var id: String { name }
}

nonisolated struct PermissionOption: Decodable, Identifiable, Sendable {
  var optionId: String
  var name: String
  var kind: String
  var id: String { optionId }

  // Allow, then always, then refusing: the order a person weighs them in.
  var weight: Int {
    switch kind {
    case "allow_once": 0
    case "allow_always": 1
    case "reject_once": 2
    default: 3
    }
  }

  var said: String {
    switch kind {
    case "allow_once": "Allow"
    case "allow_always": "Always"
    case "reject_once": "No"
    case "reject_always": "Never"
    default: name
    }
  }
}

// A conversation the agent keeps, as its own list has it.
nonisolated struct PastChat: Decodable, Identifiable, Sendable {
  var sessionId: String
  var title: String?
  var updatedAt: String?
  var id: String { sessionId }

  // When it was last worked on, short enough for a row: now, 5m, 2h, 3d.
  var ago: String {
    guard let at = PastChat.at(updatedAt) else { return "" }
    let minutes = Int(Date.now.timeIntervalSince(at) / 60)
    if minutes < 1 { return "now" }
    if minutes < 60 { return "\(minutes)m" }
    if minutes < 1440 { return "\(minutes / 60)h" }
    return "\(minutes / 1440)d"
  }

  private static func at(_ said: String?) -> Date? {
    guard let said else { return nil }
    let fractional = Date.ISO8601FormatStyle().year().month().day()
      .time(includingFractionalSeconds: true)
    if let at = try? Date(said, strategy: fractional) { return at }
    return try? Date(said, strategy: .iso8601)
  }
}

// How full a conversation is, as the door reckons it from Claude Code's
// own record on the machine.
nonisolated struct Fullness: Decodable, Sendable {
  var max: Int
  var segments: [Segment]

  nonisolated struct Segment: Decodable, Sendable {
    var label: String
    var tokens: Int
  }

  var used: Int { segments.reduce(0) { $0 + $1.tokens } }
  var full: Double { max > 0 ? min(1, Double(used) / Double(max)) : 0 }
}

// What one of the agent's terminals has written, as the door says it.
nonisolated struct TerminalSaid: Decodable, Sendable {
  var id: String
  var output: String
  var truncated: Bool?
  var exitStatus: Exit?

  nonisolated struct Exit: Decodable, Sendable {
    var exitCode: Int?
    var signal: String?
  }

  // How a command ended, where it did not end well.
  var how: String {
    if let signal = exitStatus?.signal, !signal.isEmpty { return " (stopped)" }
    if let code = exitStatus?.exitCode, code != 0 { return " (exit \(code))" }
    return ""
  }
}

// A message's content comes as one piece; a tool call's comes as a list.
nonisolated enum SpokenPayload: Decodable, Sendable {
  case one(Spoken)
  case many([ToolContent])

  init(from decoder: any Decoder) throws {
    if let many = try? [ToolContent](from: decoder) {
      self = .many(many)
    } else {
      self = .one(try Spoken(from: decoder))
    }
  }

  var words: String {
    if case .one(let content) = self { return content.words }
    return ""
  }
  var pieces: [ToolContent] {
    if case .many(let pieces) = self { return pieces }
    return []
  }
}

// Everything the agent tells the client about one conversation, in its
// own words: which kind it is decides which of these are filled.
nonisolated struct AgentUpdate: Decodable, Sendable {
  var sessionUpdate: String
  var content: SpokenPayload?
  var toolCallId: String?
  var title: String?
  var kind: ToolKind?
  var status: ToolStatus?
  var entries: [PlanEntry]?
  var currentModeId: String?
  var availableCommands: [AgentCommand]?
  // A question the agent asked the person, standing until answered: the
  // notification's id, with what it offers.
  var id: String?
  var body: String?
  var options: [String]?
  var meta: Meta?

  nonisolated struct Meta: Decodable, Sendable {
    var claudeCode: ClaudeCode?
    nonisolated struct ClaudeCode: Decodable, Sendable {
      var toolName: String?
    }
  }

  enum CodingKeys: String, CodingKey {
    case sessionUpdate, content, toolCallId, title, kind, status, entries
    case currentModeId, availableCommands, id, body, options
    case meta = "_meta"
  }
}

// A conversation as the door tells of it.
nonisolated struct ChatSaid: Decodable, Sendable {
  var id: String
  var running: Bool?
  var modes: Modes?
  var title: String?
  var clear: Bool?
  var gone: Bool?
  var answered: String?
  var context: Fullness?

  nonisolated struct Modes: Decodable, Sendable {
    var currentModeId: String?
    var availableModes: [AgentMode]?
  }
}

// What belongs to the door rather than to the agent.
nonisolated struct DoorWord: Decodable, Sendable {
  var clear: Bool?
  var state: String?
  var why: String?
  var chats: [ChatSaid]?
  var chat: ChatSaid?
  var terminal: TerminalSaid?
}

// The number or the name a call and its answer share.
nonisolated enum AskID: Decodable, Hashable, Sendable {
  case number(Int)
  case text(String)

  init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let n = try? c.decode(Int.self) {
      self = .number(n)
    } else {
      self = .text(try c.decode(String.self))
    }
  }

  var json: Any {
    switch self {
    case .number(let n): n
    case .text(let s): s
    }
  }
  var text: String {
    switch self {
    case .number(let n): String(n)
    case .text(let s): s
    }
  }
}

// One line on the socket, in either direction.
nonisolated struct AgentLine: Decodable, Sendable {
  var id: AskID?
  var method: String?
  var params: Params?
  var error: Failed?
  var maslow: DoorWord?

  nonisolated struct Params: Decodable, Sendable {
    var sessionId: String?
    var update: AgentUpdate?
    var options: [PermissionOption]?
    var toolCall: Asked?

    nonisolated struct Asked: Decodable, Sendable {
      var toolCallId: String?
      var title: String?
      var kind: ToolKind?
    }
  }

  nonisolated struct Failed: Decodable, Sendable {
    var code: Int?
    var message: String?
  }
}

// The conversations the agent keeps, as `session/list` answers.
nonisolated struct ListedChats: Decodable, Sendable {
  var result: Sessions?
  nonisolated struct Sessions: Decodable, Sendable {
    var sessions: [PastChat]?
  }
}

// One thing in the transcript. A message grows as its chunks arrive; a
// tool row, a plan and a thought each change in place.
nonisolated struct TranscriptItem: Identifiable, Sendable {
  nonisolated enum Kind: Sendable {
    case said(person: Bool, text: String)
    case thought(String)
    // The subagent a step was taken inside, where it was taken inside
    // one: the protocol has no place for it, so the order the steps
    // arrive in is what says so.
    case tool(ToolCall, under: String?)
    case plan([PlanEntry])
  }

  let id: Int
  var kind: Kind
}

extension [TranscriptItem] {
  // The transcript with one more of the agent's words folded into it.
  mutating func fold(_ update: AgentUpdate) {
    let id = count
    switch update.sessionUpdate {
    case "agent_message_chunk":
      let text = update.content?.words ?? ""
      guard !text.isEmpty else { return }
      if case .said(false, let was) = last?.kind {
        self[count - 1].kind = .said(person: false, text: was + text)
      } else {
        append(TranscriptItem(id: id, kind: .said(person: false, text: text)))
      }
    // What the person said arrives whole, one message to a turn, so two
    // in a row are two messages and never one run together.
    case "user_message_chunk":
      let text = update.content?.words ?? ""
      guard !text.isEmpty else { return }
      append(TranscriptItem(id: id, kind: .said(person: true, text: text)))
    case "agent_thought_chunk":
      let text = update.content?.words ?? ""
      guard !text.isEmpty else { return }
      if case .thought(let was) = last?.kind {
        self[count - 1].kind = .thought(was + text)
      } else {
        append(TranscriptItem(id: id, kind: .thought(text)))
      }
    // A call is announced as soon as the agent starts writing its input
    // and again once it is whole, so the second announcement changes the
    // row rather than adding another.
    case "tool_call":
      guard let toolCallId = update.toolCallId else { return }
      let call = ToolCall(
        toolCallId: toolCallId,
        title: update.title ?? "Working",
        kind: update.kind ?? .other,
        status: update.status ?? .pending,
        content: update.content?.pieces ?? [],
        toolName: update.meta?.claudeCode?.toolName)
      if let at = firstIndex(of: toolCallId) {
        if case .tool(_, let under) = self[at].kind {
          self[at].kind = .tool(call, under: under)
        }
      } else {
        append(TranscriptItem(id: id, kind: .tool(call, under: subagent())))
      }
    case "tool_call_update":
      guard let toolCallId = update.toolCallId, let at = firstIndex(of: toolCallId),
        case .tool(var call, let under) = self[at].kind
      else { return }
      if let title = update.title { call.title = title }
      if let kind = update.kind { call.kind = kind }
      if let status = update.status { call.status = status }
      // What a call has to show arrives whole rather than in pieces, so what came last
      // is what the row shows.
      if let pieces = update.content?.pieces, !pieces.isEmpty { call.content = pieces }
      self[at].kind = .tool(call, under: under)
    case "plan":
      guard let entries = update.entries else { return }
      if let at = firstIndex(where: { if case .plan = $0.kind { true } else { false } }) {
        self[at].kind = .plan(entries)
      } else {
        append(TranscriptItem(id: id, kind: .plan(entries)))
      }
    default:
      return
    }
  }

  private func firstIndex(of toolCallId: String) -> Int? {
    firstIndex {
      if case .tool(let call, _) = $0.kind { call.toolCallId == toolCallId } else { false }
    }
  }

  // The subagent still working, if any: its steps arrive between its own
  // call and its result, so what came after it and before its answer is
  // what it did.
  private func subagent() -> String? {
    for item in reversed() {
      guard case .tool(let call, _) = item.kind, call.toolName == "Task" else { continue }
      return call.status == .completed || call.status == .failed ? nil : call.toolCallId
    }
    return nil
  }
}
