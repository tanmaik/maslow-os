import Foundation

// A socket straight from the phone to the person's computer's door, on a
// ticket our sign-in mints: the address and the ticket come from
// /computer/live, good for an hour, and the socket dials the machine itself.
// The door never pings, so the phone does; a socket that closes is reported
// and the owner reconnects.
nonisolated struct Live: Decodable, Sendable {
  var door: String
  var ticket: String
}

extension API {
  // Where the computer's door is and the ticket that opens it, or a refusal
  // with the server's own sentence when the computer is not ready.
  func live() async throws -> Live {
    try await get("/computer/live")
  }
}

nonisolated enum Frame: Sendable {
  case text(String)
  case data(Data)
}

// One open socket to one of the door's paths. Frames arrive on `frames`
// until the socket closes; `send` writes. Made per connection, dropped on
// close: the owner makes another.
nonisolated final class DoorSocket: Sendable {
  let frames: AsyncStream<Frame>
  private let task: URLSessionWebSocketTask
  private let continuation: AsyncStream<Frame>.Continuation
  private let keepalive: Task<Void, Never>

  // Opens `path` on the door with the ticket and any extra query, resolving
  // once the socket is open and throwing when it is refused.
  init(_ live: Live, path: String, query: [String: String] = [:]) async throws {
    var url = URLComponents(string: live.door + path)!
    url.queryItems = [URLQueryItem(name: "ticket", value: live.ticket)]
      + query.map { URLQueryItem(name: $0.key, value: $0.value) }
    let task = URLSession.shared.webSocketTask(with: url.url!)
    task.maximumMessageSize = 64 * 1024 * 1024
    self.task = task
    (frames, continuation) = AsyncStream.makeStream(of: Frame.self)
    task.resume()
    // Reading starts first: a pong is only parsed while frames are being
    // drained, and the door speaks the moment the socket opens.
    Task { [task, continuation] in
      while true {
        do {
          switch try await task.receive() {
          case .string(let s): continuation.yield(.text(s))
          case .data(let d): continuation.yield(.data(d))
          @unknown default: break
          }
        } catch {
          continuation.finish()
          return
        }
      }
    }
    // A first pong proves the door opened it; a refusal fails here.
    try await task.sendPing()
    let t = task
    keepalive = Task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(20))
        try? await t.sendPing()
      }
    }
  }

  func send(_ text: String) async throws {
    try await task.send(.string(text))
  }

  func send(_ data: Data) async throws {
    try await task.send(.data(data))
  }

  func send(json: Any) async throws {
    try await send(String(decoding: JSONSerialization.data(withJSONObject: json), as: UTF8.self))
  }

  func close() {
    keepalive.cancel()
    task.cancel(with: .normalClosure, reason: nil)
    continuation.finish()
  }
}

private extension URLSessionWebSocketTask {
  func sendPing() async throws {
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, any Error>) in
      sendPing { error in
        if let error { c.resume(throwing: error) } else { c.resume() }
      }
    }
  }
}
