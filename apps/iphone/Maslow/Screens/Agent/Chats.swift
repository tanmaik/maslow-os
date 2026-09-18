import Foundation
import Observation

// Every conversation the person's computer has open, held once for the
// Agent tab: one socket to the door, the record of each conversation as it
// arrives, and the words the phone says back. Nothing durable is here —
// the conversations are on the machine, the door replays them to every
// socket, and a phone that comes back takes the replay.

// One conversation as the phone holds it.
nonisolated struct Chat: Identifiable, Sendable {
  var id: String
  var items: [TranscriptItem] = []
  var asks: [Ask] = []
  var running = false
  var mode: String?
  var modes: [AgentMode] = []
  var commands: [AgentCommand] = []
  var context: Fullness?
  var title: String?
}

// What the agent asks the person before it acts, as it arrives.
nonisolated struct Ask: Identifiable, Sendable {
  var askId: AskID
  var title: String
  var kind: ToolKind
  var options: [PermissionOption]
  // A question standing until the person answers it, here or behind the
  // clock: the notification's id is the ask's, with what it offers.
  var asked: Asked?
  var id: AskID { askId }

  nonisolated struct Asked: Sendable {
    var body: String
    var choices: [String]
  }
}

// A piece of what the person is about to send: their words, a picture, or
// a file already put on their computer.
nonisolated enum PromptPart: Sendable {
  case text(String)
  case image(data: String, mimeType: String)
  case file(uri: String, name: String)

  var json: [String: Any] {
    switch self {
    case .text(let text): ["type": "text", "text": text]
    case .image(let data, let mimeType): ["type": "image", "data": data, "mimeType": mimeType]
    case .file(let uri, let name): ["type": "resource_link", "uri": uri, "name": name]
    }
  }
}

// How the agent acts on a phone: bypass, never asking, said to every
// conversation as it opens, since the person is not there to answer.
private let auto = "bypassPermissions"
// A ticket lives an hour and is not renewed on a live socket, so the
// socket is made afresh well before it lapses.
private let ticketLife = Duration.seconds(3000)

@Observable
final class Chats {
  // Why there is no agent to talk to yet, or nil once there is.
  private(set) var away: String? = "Connecting…"
  private(set) var chats: [String: Chat] = [:]
  // Every conversation the machine keeps, newest first.
  private(set) var past: [PastChat] = []
  // What the agent's own terminals have written, by the id the protocol
  // gave each.
  private(set) var wrote: [String: TerminalSaid] = [:]
  // Why something the person tried did not happen.
  private(set) var refused: String?
  // The conversation opened most recently by this phone's own asking.
  private(set) var newest: String?

  private var api: API?
  private var socket: DoorSocket?
  private var lines: AsyncStream<String>.Continuation?
  private var asked = 0
  private var listing: Int?
  // Whether this phone asked for a new conversation and awaits it.
  private var asking = false
  private var known: Set<String> = []
  private let decoder = JSONDecoder()

  var mode: String { auto }

  // One socket to the door for as long as the tab is up: a socket that
  // closes is made again a second later, a ticket the server refuses is
  // asked for again in five, and the door replays everything either way.
  func run(_ api: API) async {
    self.api = api
    while !Task.isCancelled {
      do {
        let live = try await api.live()
        let socket = try await DoorSocket(live, path: "/maslow/agent")
        hold(socket)
        // The protocol's first word. The door answers it from the
        // handshake it already holds, so what this says of the phone is
        // only that it runs nothing on the machine itself.
        call(
          "initialize",
          [
            "protocolVersion": 1,
            "clientCapabilities": [
              "fs": ["readTextFile": false, "writeTextFile": false], "terminal": false,
            ],
          ])
        let age = Task { [weak self] in
          try? await Task.sleep(for: ticketLife)
          self?.drop()
        }
        for await frame in socket.frames {
          if case .text(let said) = frame { heard(said) }
        }
        age.cancel()
        drop()
        if Task.isCancelled { return }
        away = "Reconnecting…"
        try? await Task.sleep(for: .seconds(1))
      } catch {
        drop()
        if Task.isCancelled { return }
        away = error.localizedDescription
        try? await Task.sleep(for: .seconds(5))
      }
    }
    drop()
  }

  // The phone coming back to the front: the socket iOS left behind is let
  // go, and the loop makes a new one with a fresh ticket.
  func rouse() {
    guard socket != nil else { return }
    drop()
  }

  // The socket, with one task writing everything the phone says in the
  // order it said it.
  private func hold(_ socket: DoorSocket) {
    let (queued, sink) = AsyncStream.makeStream(of: String.self)
    self.socket = socket
    self.lines = sink
    Task {
      for await line in queued { try? await socket.send(line) }
    }
  }

  private func drop() {
    lines?.finish()
    lines = nil
    socket?.close()
    socket = nil
    listing = nil
  }

  // One line out.
  private func say(_ line: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: line) else { return }
    lines?.yield(String(decoding: data, as: UTF8.self))
  }

  // Something asked of the agent, under a number of ours the door maps
  // back to the answer.
  @discardableResult
  private func call(_ method: String, _ params: [String: Any]) -> Int {
    asked += 1
    say(["jsonrpc": "2.0", "id": asked, "method": method, "params": params])
    return asked
  }

  // The conversations the agent keeps, asked for whenever one appears, is
  // renamed, or the agent goes ready, so the list names every one.
  private func list() {
    listing = call("session/list", [:])
  }

  // One line in: the door's own word about the conversations, something
  // the agent says about one of them, something it asks the person, or an
  // answer to something asked here.
  private func heard(_ said: String) {
    let data = Data(said.utf8)
    guard let line = try? decoder.decode(AgentLine.self, from: data) else { return }
    if let word = line.maslow { return heard(word) }
    if let sessionId = line.params?.sessionId, line.method == "session/update",
      let update = line.params?.update
    {
      return heard(update, in: sessionId)
    }
    if line.method == "session/request_permission", let askId = line.id,
      let sessionId = line.params?.sessionId
    {
      return leave(askId, in: sessionId, line.params)
    }
    // An answer. An agent that refuses — no credit, no auth, a prompt it
    // would not take — says why, and the person reads it rather than
    // watching nothing happen.
    if let askId = line.id, line.method == nil {
      if let why = line.error?.message { refused = why }
      if case .number(let n) = askId, n == listing,
        let sessions = try? decoder.decode(ListedChats.self, from: data).result?.sessions
      {
        past = sessions
        listing = nil
      }
    }
  }

  private func heard(_ word: DoorWord) {
    if word.clear == true {
      chats = [:]
      wrote = [:]
      known = []
    }
    for said in word.chats ?? [] {
      known.insert(said.id)
      apply(said)
    }
    if let said = word.chat {
      let arrived = !known.contains(said.id)
      known.insert(said.id)
      apply(said)
      if arrived || said.title != nil { list() }
      if arrived, said.clear == true, asking {
        asking = false
        newest = said.id
      }
    }
    if let terminal = word.terminal { wrote[terminal.id] = terminal }
    switch word.state {
    case "failed": away = word.why ?? "Your agent would not start on your computer."
    case "ready":
      away = nil
      list()
    case .some: away = "Starting your agent…"
    case nil: break
    }
  }

  // One conversation changed, made where it was not yet known.
  private func apply(_ said: ChatSaid) {
    var chat = chats[said.id] ?? Chat(id: said.id)
    if said.clear == true {
      chat = Chat(id: said.id, mode: chat.mode, modes: chat.modes, title: chat.title)
    }
    if said.gone == true { chat.running = false }
    if let running = said.running {
      chat.running = running
      // No prompt, no leave pending from it; a question stands.
      if !running { chat.asks = chat.asks.filter { $0.asked != nil } }
    }
    if let answered = said.answered {
      chat.asks = chat.asks.filter { $0.askId.text != answered }
    }
    if let modes = said.modes {
      // Claude Code opens every conversation asking before it acts; the
      // device's choice, bypass until the person changes it, is set over it.
      let offered = modes.availableModes ?? []
      let now = modes.currentModeId
      let kept = mode
      let to = now != nil && now != kept && offered.contains { $0.id == kept } ? kept : now
      if to != now, let to { call("session/set_mode", ["sessionId": said.id, "modeId": to]) }
      chat.modes = offered
      chat.mode = to
    }
    if let title = said.title {
      chat.title = title
      past = past.map { $0.sessionId == said.id ? PastChat(sessionId: $0.sessionId, title: title, updatedAt: $0.updatedAt) : $0 }
    }
    if let context = said.context { chat.context = context }
    chats[said.id] = chat
  }

  private func heard(_ update: AgentUpdate, in sessionId: String) {
    var chat = chats[sessionId] ?? Chat(id: sessionId)
    switch update.sessionUpdate {
    case "_maslow/asked":
      guard let id = update.id else { return }
      let askId = AskID.text(id)
      chat.asks = chat.asks.filter { $0.askId != askId }
      chat.asks.append(
        Ask(
          askId: askId, title: update.title ?? "Your agent asks", kind: .other, options: [],
          asked: Ask.Asked(body: update.body ?? "", choices: update.options ?? [])))
    case "current_mode_update":
      chat.mode = update.currentModeId
    case "available_commands_update":
      chat.commands = update.availableCommands ?? []
    default:
      chat.items.fold(update)
    }
    chats[sessionId] = chat
  }

  // Leave to act. It blocks nothing else: the rest of the transcript
  // keeps arriving under it.
  private func leave(_ askId: AskID, in sessionId: String, _ params: AgentLine.Params?) {
    let title = params?.toolCall?.title ?? "Your agent wants to run a tool."
    // The adapter's own shell tool comes as no kind in particular; a
    // command is known by the backticks its title wears.
    var kind = params?.toolCall?.kind ?? .other
    if kind == .other, title.hasPrefix("`") { kind = .execute }
    var chat = chats[sessionId] ?? Chat(id: sessionId)
    chat.asks.append(
      Ask(
        askId: askId, title: title, kind: kind,
        options: (params?.options ?? []).sorted { $0.weight < $1.weight }, asked: nil))
    chats[sessionId] = chat
  }

  // A new conversation, handed over at once since the door keeps one warm.
  func begin() {
    asking = true
    say(["maslow": ["fresh": true]])
  }

  func open(_ id: String) {
    say(["maslow": ["open": id]])
  }

  // A conversation closed here: its process is freed and it opens again
  // whole when it is wanted.
  func close(_ id: String) {
    say(["maslow": ["close": id]])
    chats[id] = nil
    known.remove(id)
  }

  // A name the person gives a conversation, kept by the door.
  func name(_ id: String, _ title: String) {
    say(["maslow": ["name": ["id": id, "title": title]]])
    chats[id]?.title = title
  }

  // What the person said, sent as a prompt; a word into a running turn
  // joins that turn rather than waiting for it.
  func send(_ prompt: [PromptPart], to id: String) {
    refused = nil
    chats[id]?.running = true
    call("session/prompt", ["sessionId": id, "prompt": prompt.map(\.json)])
  }

  // The prompt stopped where it is: the agent gives up what it was doing
  // and says so, and what it already did stands.
  func stop(_ id: String) {
    say(["jsonrpc": "2.0", "method": "session/cancel", "params": ["sessionId": id]])
    chats[id]?.asks = []
  }

  // An answer: to a question, through the app, which says it back into
  // the conversation; to leave to act, straight to the agent.
  func answer(_ ask: Ask, _ said: String, in id: String) {
    if ask.asked != nil {
      let api = self.api
      let askId = ask.askId.text
      Task { try? await api?.answerAsk(askId, said) }
    }
    chats[id]?.asks.removeAll { $0.askId == ask.askId }
  }

  func allow(_ ask: Ask, _ option: PermissionOption, in id: String) {
    say([
      "jsonrpc": "2.0", "id": ask.askId.json,
      "result": ["outcome": ["outcome": "selected", "optionId": option.optionId]],
    ])
    chats[id]?.asks.removeAll { $0.askId == ask.askId }
  }
}
