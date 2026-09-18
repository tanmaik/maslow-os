import Foundation

// The brain's writing doors, as the phone posts to them: a form urlencoded
// the way a browser sends one, and the page the door sends the browser back
// to read as the answer.

// What a door said when it would not do the thing.
nonisolated enum Refusal: Error, LocalizedError, Equatable {
  case said(String)
  case behind
  case signedOut
  case unreachable
  case status(Int)

  var errorDescription: String? {
    switch self {
    case .said(let said): said
    case .behind: "This record changed since you opened it."
    case .signedOut: "You were signed out."
    case .unreachable: "Maslow can't be reached."
    case .status(let code): "The server answered \(code)."
    }
  }
}

// Whom a share may be given to: the org's members and its groups. Everyone
// is not a row and is named by name.
nonisolated struct Who: Decodable, Sendable {
  nonisolated struct Member: Decodable, Identifiable, Sendable {
    var id: String
    var name: String
    var me: Bool
  }
  nonisolated struct Group: Decodable, Identifiable, Sendable {
    var id: String
    var name: String
  }
  var members: [Member]
  var groups: [Group]
}

// What waits on the person, as the notifications door answers it.
nonisolated struct Waiting: Decodable, Sendable {
  var notifications: [Notice]
  var titles: [String: String]
  var waiting: Int
  var unread: Int
}

// A field declared with the first record of a type made up here.
nonisolated struct NewField: Identifiable, Hashable, Sendable {
  var id = UUID()
  var label = ""
  var datatype = "text"
  var options = ""

  // The name a label becomes: lowercase words joined by underscores.
  var name: String {
    let lowered = label.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "_" }
    return String(lowered)
      .split(separator: "_", omittingEmptySubsequences: true)
      .joined(separator: "_")
  }
}

extension API {
  // Writes a record the person typed in, and answers the id of the record
  // it wrote. A type made up here is declared in the same call.
  nonisolated func write(
    type: String, fresh: Bool, title: String, body: String,
    values: [String: String], declaring: [NewField]
  ) async throws -> String {
    var fields = [("type", type), ("title", title), ("body", body)]
    if fresh { fields.append(("new", "1")) }
    for (name, value) in values.sorted(by: { $0.key < $1.key }) {
      fields.append(("p.\(name)", value))
    }
    for (i, f) in declaring.enumerated() where !f.name.isEmpty {
      fields.append(("f\(i).name", f.name))
      fields.append(("f\(i).datatype", f.datatype))
      if f.datatype == "enum" { fields.append(("f\(i).options", f.options)) }
    }
    let (_, to) = try await sent("/brain/records", fields)
    guard let id = to?.lastPathComponent, id.count == 10 else {
      throw Refusal.said("The record was written but the door did not say which.")
    }
    return id
  }

  // The number of the last change to one record, which the next save names.
  nonisolated func lastChange(_ id: String) async throws -> Int {
    struct Answer: Decodable { var seen: Int }
    let answer: Answer = try await get("/brain/records/\(id)/change")
    return answer.seen
  }

  // Changes a record's title, body or one of its declared fields, naming
  // the last change it saw; answers the change it just made. A save that
  // fell behind is refused.
  nonisolated func edit(
    _ id: String, seen: Int, title: String? = nil, body: String? = nil,
    values: [String: String] = [:]
  ) async throws -> Int {
    var fields = [("seen", String(seen))]
    if let title { fields.append(("title", title)) }
    if let body { fields.append(("body", body)) }
    for (name, value) in values.sorted(by: { $0.key < $1.key }) {
      fields.append(("p.\(name)", value))
    }
    let (data, _) = try await sent("/brain/records/\(id)/change", fields)
    let made = (try? JSONDecoder().decode([String: Int].self, from: data))?["seen"] ?? 0
    return made > 0 ? made : try await lastChange(id)
  }

  // Hides a record behind a pointer, or brings it back.
  nonisolated func mark(_ id: String, intent: String) async throws {
    _ = try await sent("/brain/records/\(id)/change", [("intent", intent)])
  }

  // Takes away every link a chip stands for.
  nonisolated func unlink(_ id: String, edges: [String]) async throws {
    _ = try await sent(
      "/brain/records/\(id)/change",
      [("intent", "unlink")] + edges.map { ("edge", $0) })
  }

  // Links this record to another under a verb, in the direction chosen.
  nonisolated func link(_ id: String, to other: String, verb: String, out: Bool) async throws {
    _ = try await sent(
      "/brain/records/\(id)/link",
      [("other", other), ("verb", verb), ("direction", out ? "out" : "in")])
  }

  // Shares a record or a type with a person, a group or everyone.
  nonisolated func share(record: String? = nil, type: String? = nil, with subject: String, at level: String)
    async throws
  {
    var fields = [("subject", subject), ("level", level)]
    if let record { fields.append(("record", record)) }
    if let type { fields.append(("type", type)) }
    _ = try await sent("/brain/share", fields)
  }

  // Answers an ask to share as it stands: share as it asked, or not.
  nonisolated func answerShareAsk(_ request: String, accept: Bool) async throws {
    _ = try await sent(
      "/brain/requests", [("request", request), ("intent", accept ? "accept" : "decline")])
  }

  nonisolated func who() async throws -> Who {
    try await get("/brain/who")
  }

  // The few records a picker offers for what was typed.
  nonisolated func pick(_ query: String, not: String) async throws -> [Ref] {
    struct Answer: Decodable { var records: [Ref] }
    let answer: Answer = try await get("/brain/search", ["q": query, "not": not])
    return answer.records
  }

  // A page of records, narrowed by the conditions the person set and
  // ordered as they asked.
  nonisolated func records(
    type: String?, owner: String?, terms: [Term], sort: Sorted, cursor: String? = nil
  ) async throws -> Page {
    try await get(
      "/brain/read",
      [
        "type": type, "owner": owner, "cursor": cursor, "limit": "50",
        "where": terms.isEmpty ? nil : terms.map(\.param).joined(separator: "\n"),
        "sort": sort.property, "dir": sort.ascending ? "asc" : "desc",
      ])
  }

  nonisolated func waiting() async throws -> Waiting {
    try await get("/notifications")
  }
  nonisolated func readWaiting() async throws -> Waiting {
    try await post("/notifications", ["read": true])
  }
  nonisolated func clearWaiting() async throws -> Waiting {
    try await post("/notifications", ["clear": true])
  }
  nonisolated func answerNotice(_ id: String, _ answer: String) async throws -> Waiting {
    try await post("/notifications", ["id": id, "answer": answer])
  }

  // Posts a form to a door and answers what came back: the bare JSON a
  // page saving as it goes asks for, or where the door sent a browser.
  nonisolated func sent(_ path: String, _ fields: [(String, String)]) async throws -> (
    data: Data, to: URL?
  ) {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    var form = URLComponents()
    form.queryItems = fields.map { URLQueryItem(name: $0.0, value: $0.1) }
    // A plus in a value is a plus, not the space a form decoder reads it as.
    let query = (form.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    request.httpBody = Data(query.utf8)
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request, delegate: Stay.put)
    } catch {
      throw Refusal.unreachable
    }
    guard let http = response as? HTTPURLResponse else { throw Refusal.unreachable }
    switch http.statusCode {
    case 200..<300:
      return (data, nil)
    case 300..<400:
      let to = http.value(forHTTPHeaderField: "location")
        .flatMap { URL(string: $0, relativeTo: server) }
      if let said = to.flatMap(Self.said) { throw Refusal.said(said) }
      return (data, to)
    case 401:
      throw Refusal.signedOut
    case 409:
      throw Refusal.behind
    case 400, 403, 404:
      let said = String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      throw Refusal.said(said.isEmpty ? "The door refused it." : said)
    default:
      throw Refusal.status(http.statusCode)
    }
  }

  // What a door said, carried back in the address it sent the page to.
  private nonisolated static func said(in url: URL) -> String? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == "said" }?.value
  }
}

// A post that stops at the door's own answer, since where the door sends a
// browser is what it has to say.
private final class Stay: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  static let put = Stay()

  nonisolated func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
