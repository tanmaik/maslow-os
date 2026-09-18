import Foundation

// What the Agent needs from our own server beside the door's socket: the
// week's spend, the answer to a question the agent asked, and where a file
// the person attaches is to be put on their computer.

// The week's spend against the person's own ceiling, in dollars.
nonisolated struct Spend: Decodable, Sendable {
  var spentUsd: Double
  var capUsd: Double
  var resetsAt: Date

  var reached: Bool { spentUsd >= capUsd }
  var full: Double { capUsd > 0 ? min(1, spentUsd / capUsd) : 0 }

  // "$3.42", "$10".
  static func dollars(_ usd: Double) -> String {
    usd >= 10 || usd == 0
      ? "$" + ((usd * 100).rounded() / 100).formatted(.number.precision(.fractionLength(0...2)))
      : "$" + usd.formatted(.number.precision(.fractionLength(2)))
  }

  var said: String {
    reached
      ? "Weekly limit reached"
      : "\(Spend.dollars(spentUsd)) of \(Spend.dollars(capUsd))"
  }
}

extension API {
  // The week's spend, read once a minute. A deployment that mints no
  // model keys has none to answer.
  func spend() async throws -> Spend {
    try await get("/usage")
  }

  // An answer to a question the agent asked: the same door the panel
  // behind the clock answers through, so the answer goes back into the
  // conversation as its next word.
  func answerAsk(_ id: String, _ said: String) async throws {
    let _: Fine = try await post("/notifications", ["id": id, "answer": said])
  }

  // Where a file goes and what it carries to be let in: the machine's own
  // door and a ticket for it. The bytes never pass through our server.
  func uploadTarget() async throws -> Live {
    try await post("/computer/files/upload", [:])
  }

  private struct Fine: Decodable {}
}
