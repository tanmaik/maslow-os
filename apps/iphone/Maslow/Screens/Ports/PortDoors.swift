import Foundation

// A port listening inside the person's own computer, as its door reports
// it this moment.
nonisolated struct Listening: Decodable, Identifiable, Sendable {
  var port: Int
  var name: String
  // What is running there, when the machine knows the command.
  var ran: String?
  var id: Int { port }

  // What the row says the port is, in the fewest words that are true.
  var said: String {
    if let ran, !ran.isEmpty { return ran }
    return name
  }
}

// A port somebody else opened to the person, or one of theirs placed on
// the desktop: the link on our own domain and the title that says whose it
// is.
nonisolated struct PortLink: Decodable, Identifiable, Sendable {
  var title: String
  var href: String
  var id: String { href }
}

// Who each of the person's own ports reaches, and whom they may name: every
// member of the org and every group in it.
nonisolated struct PortSharing: Decodable, Sendable {
  nonisolated struct Party: Decodable, Identifiable, Sendable {
    var id: String
    var name: String
  }

  nonisolated struct Share: Decodable, Sendable {
    var port: Int
    var subject: String
    var memberId: String?
    var groupId: String?
  }

  var machineId: String
  var members: [Party]
  var groups: [Party]
  var shares: [Share]

  // What one port reaches now, as the sheet takes it.
  func reach(of port: Int) -> PortReach {
    let on = shares.filter { $0.port == port }
    return PortReach(
      everyone: on.contains { $0.subject == "everyone" },
      groupIds: Set(on.compactMap(\.groupId)),
      memberIds: Set(on.compactMap(\.memberId)))
  }
}

// Whom a port is open to: everyone in the org, or some groups and some
// people. A port reaches at view and there is no other level.
nonisolated struct PortReach: Equatable, Sendable {
  var everyone = false
  var groupIds: Set<String> = []
  var memberIds: Set<String> = []

  var isShared: Bool { everyone || !groupIds.isEmpty || !memberIds.isEmpty }

  // What a port's row says about who has it.
  var said: String? {
    if everyone { return "Everyone" }
    var parts: [String] = []
    if !groupIds.isEmpty {
      parts.append(groupIds.count == 1 ? "1 group" : "\(groupIds.count) groups")
    }
    if !memberIds.isEmpty {
      parts.append(memberIds.count == 1 ? "1 person" : "\(memberIds.count) people")
    }
    return parts.isEmpty ? nil : parts.joined(separator: ", ")
  }
}

extension API {
  // The ports listening on the person's own computer, read from its door.
  func listening() async throws -> [Listening] {
    struct Answer: Decodable { var ports: [Listening] }
    let a: Answer = try await get("/computer/stats")
    return a.ports
  }

  // Every port the person can open this moment: their own, and those other
  // people opened to them. A computer that does not answer leaves them
  // unsaid rather than empty.
  func openablePorts() async throws -> [PortLink] {
    struct Answer: Decodable { var ports: [PortLink]? }
    let a: Answer = try await get("/desktop/ports")
    return a.ports ?? []
  }

  // The machine the person's own ports are on, so a port of theirs is told
  // from one of a colleague's.
  func machine() async throws -> String? {
    struct Answer: Decodable { var machine: String? }
    let a: Answer = try await get("/desktop/about")
    return a.machine
  }

  // The widgets on the person's desktop: the ports the agent put on the
  // ground itself, by name.
  func widgets() async throws -> [PortLink] {
    struct Card: Decodable {
      var kind: String
      var title: String
      var href: String
      var pinned: Bool?
    }
    struct Layout: Decodable { var cards: [Card] }
    struct Answer: Decodable { var layout: Layout? }
    let a: Answer = try await get("/desktop/layout")
    return (a.layout?.cards ?? [])
      .filter { $0.pinned == true && $0.kind == "port" }
      .map { PortLink(title: $0.title, href: $0.href) }
  }

  // Who reaches each of the person's ports, and whom they may name.
  func sharing() async throws -> PortSharing {
    try await get("/computer/share")
  }

  // Makes what one port reaches exactly this: whoever is left off is taken
  // off in the same act.
  func share(port: Int, to reach: PortReach) async throws {
    var pairs = [("port", String(port))]
    if reach.everyone { pairs.append(("everyone", "on")) }
    pairs += reach.groupIds.map { ("group", $0) }
    pairs += reach.memberIds.map { ("member", $0) }
    try await form("/computer/share", pairs)
  }

  // Where a port is really reached: our own door looks up the share, mints
  // a ticket for that port alone and points at the machine. A port that is
  // not there, or not the reader's to open, is nothing at all.
  func portLink(_ href: String) async throws -> URL {
    var request = URLRequest(url: server.appending(path: href))
    request.setValue("text/html", forHTTPHeaderField: "accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    let delegate = Unfollowed()
    let response: URLResponse
    do {
      (_, response) = try await URLSession.shared.data(for: request, delegate: delegate)
    } catch {
      throw Failure.unreachable
    }
    let http = response as? HTTPURLResponse
    switch http?.statusCode ?? 0 {
    case 301...308:
      guard let at = http?.value(forHTTPHeaderField: "location"), let url = URL(string: at) else {
        throw Failure.refused("Your computer did not say where that port is.")
      }
      return url
    case 401: throw Failure.signedOut
    case 404: throw Failure.refused("That port is not there.")
    default: throw Failure.status(http?.statusCode ?? 0)
    }
  }

  // A door of ours that takes a form rather than JSON, and answers a
  // refusal as a sentence rather than as JSON.
  private func form(_ path: String, _ pairs: [(String, String)]) async throws {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    var body = URLComponents()
    body.queryItems = pairs.map { URLQueryItem(name: $0.0, value: $0.1) }
    request.httpBody = Data((body.percentEncodedQuery ?? "").utf8)
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw Failure.unreachable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    switch status {
    case 200..<300: return
    case 401: throw Failure.signedOut
    default:
      let said = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
      throw said.isEmpty || said.hasPrefix("<") ? Failure.status(status) : Failure.refused(said)
    }
  }
}

// A request whose redirect the phone reads rather than follows, so the
// address our door mints is what the page loads.
private final class Unfollowed: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  nonisolated func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
