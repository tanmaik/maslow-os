import Foundation

// The site's own doors, as the phone reads them: JSON in, JSON out, the
// session as a bearer token. A 401 means the session ended elsewhere.
nonisolated struct API: Sendable {
  let server: URL
  let token: String?

  // The session is the bearer token alone: no cookie is ever kept, so a
  // stale one can never stand in for it.
  private static let http: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.httpShouldSetCookies = false
    c.httpCookieAcceptPolicy = .never
    return URLSession(configuration: c)
  }()

  nonisolated enum Failure: Error, LocalizedError, Equatable {
    case refused(String)
    case signedOut
    case status(Int)
    case unreachable

    var errorDescription: String? {
      switch self {
      case .refused(let said): said
      case .signedOut: "You were signed out."
      case .status(let code): "The server answered \(code)."
      case .unreachable: "Maslow can't be reached."
      }
    }
  }

  nonisolated struct Opened: Decodable, Equatable, Sendable {
    var token: String
    var person: String
    var email: String
    var orgs: [Session.Org]
  }

  nonisolated struct Seeded: Decodable, Identifiable, Sendable {
    var userId: String
    var name: String
    var org: String
    var id: String { userId }
  }

  // Sign-in.
  func sendCode(to email: String) async throws {
    let _: Sent = try await post("/auth/device", ["email": email])
  }
  func redeem(email: String, code: String) async throws -> Opened {
    try await post("/auth/device", ["email": email, "code": code])
  }
  func seeded() async throws -> [Seeded] {
    struct Answer: Decodable { var seeded: [Seeded] }
    let a: Answer = try await get("/auth/device")
    return a.seeded
  }
  func signIn(seeded userId: String) async throws -> Opened {
    try await post("/auth/device", ["user": userId])
  }
  func switchOrg(to userId: String) async throws -> Opened {
    try await post("/auth/device", ["membership": userId])
  }
  func signOut() async throws {
    var request = URLRequest(url: server.appending(path: "/auth/device"))
    request.httpMethod = "DELETE"
    _ = try await send(request)
  }

  // The brain.
  func vocabulary() async throws -> Vocabulary {
    try await get("/brain/types")
  }
  func records(type: String? = nil, owner: String? = nil, query: String? = nil, cursor: String? = nil)
    async throws -> Page
  {
    try await get(
      "/brain/read",
      ["type": type, "owner": owner, "q": query, "cursor": cursor, "limit": "50"])
  }
  func record(_ id: String) async throws -> Whole {
    try await get("/brain/get", ["id": id])
  }

  // The computer.
  func about() async throws -> About {
    try await get("/desktop/about")
  }

  private struct Sent: Decodable { var sent: Bool }
  private struct Said: Decodable { var said: String }

  func get<T: Decodable>(_ path: String, _ query: [String: String?] = [:]) async throws -> T {
    var url = server.appending(path: path)
    let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }
    if !items.isEmpty { url.append(queryItems: items) }
    return try await decode(send(URLRequest(url: url)))
  }

  func post<T: Decodable>(_ path: String, _ body: [String: any Sendable]) async throws -> T {
    try await write("POST", path, body)
  }

  func put<T: Decodable>(_ path: String, _ body: [String: any Sendable]) async throws -> T {
    try await write("PUT", path, body)
  }

  func delete(_ path: String, _ body: [String: any Sendable]) async throws {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = "DELETE"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    _ = try await send(request)
  }

  private func write<T: Decodable>(_ method: String, _ path: String, _ body: [String: any Sendable]) async throws -> T {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    return try await decode(send(request))
  }

  private func send(_ given: URLRequest) async throws -> Data {
    var request = given
    request.setValue("application/json", forHTTPHeaderField: "accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await Self.http.data(for: request)
    } catch {
      throw Failure.unreachable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    switch status {
    case 200..<300: return data
    case 401: throw Failure.signedOut
    case 404: throw Failure.refused("This copy of Maslow is older than the phone. Update the server.")
    default:
      if let said = try? decoder.decode(Said.self, from: data) { throw Failure.refused(said.said) }
      throw Failure.status(status)
    }
  }

  // An answer the phone cannot read is a server older than the phone.
  private func decode<T: Decodable>(_ data: Data) throws -> T {
    do {
      return try decoder.decode(T.self, from: data)
    } catch {
      throw Failure.refused("This copy of Maslow is older than the phone. Update the server.")
    }
  }

  // Dates arrive as the database writes them, with or without fractions of
  // a second.
  private var decoder: JSONDecoder {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .custom { decoder in
      let s = try decoder.singleValueContainer().decode(String.self)
      if let date = try? Date(s, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) {
        return date
      }
      if let date = try? Date(s, strategy: .iso8601) { return date }
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "not a date: \(s)"))
    }
    return d
  }
}
