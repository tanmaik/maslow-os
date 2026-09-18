import Foundation
import Observation

// The person's computer as its own doors answer for it: where it stands,
// what it is using, the update waiting, the backups kept. Every door here
// refuses in a plain sentence rather than JSON, so the sentence is carried
// through as the error.

nonisolated struct ComputerRefused: Error, LocalizedError, Sendable {
  let said: String
  var errorDescription: String? { said }
}

// How far a computer has got, and the move it is on its way through.
nonisolated struct MachineState: Decodable, Sendable, Equatable {
  nonisolated struct Move: Decodable, Sendable, Equatable {
    var to: String
    var step: String
  }
  var progress: String
  var region: String?
  var move: Move?
  var failed: String?

  var ready: Bool { progress == "ready" }
  var off: Bool { progress == "off" }
}

// What the machine is using this moment, and what a restart would stop.
nonisolated struct MachineStats: Decodable, Sendable {
  nonisolated struct Memory: Decodable, Sendable {
    var used: Double
    var total: Double
  }
  nonisolated struct Port: Decodable, Sendable, Identifiable {
    var port: Int
    var name: String
    var id: Int { port }
  }
  var cpu: Double
  var memory: Memory
  var used: Double?
  var disk: Double?
  var ports: [Port]
  var running: [String]?

  var memoryShare: Double { memory.total > 0 ? memory.used / memory.total : 0 }
  // What a restart stops, in the words the person would use for it.
  var stops: [String] {
    ports.map { "port \($0.port)\($0.name.isEmpty ? "" : " (\($0.name))")" } + (running ?? [])
  }
}

nonisolated struct ImageUpdate: Decodable, Sendable, Equatable {
  var image: String
  var readyAt: String
}

nonisolated struct KeptBackup: Decodable, Sendable, Identifiable {
  var key: String
  var at: String
  var bytes: Double?
  var id: String { key }
}

nonisolated struct RestoringBackup: Decodable, Sendable {
  var name: String
  var step: String
  var finishedAt: String?
  var bytes: Double?
  var error: String?

  var landed: Bool { finishedAt != nil || error != nil }
}

nonisolated struct ComputerBackups: Decodable, Sendable {
  var kept: [KeptBackup]
  var restoring: RestoringBackup?
}

extension API {
  // Where the computer stands, one step further on than before: the same
  // ask makes the disk, the machine and the first start in turn.
  func computerState() async throws -> MachineState {
    try await computer("/computer/state", method: "POST")
  }

  func computerStats() async throws -> MachineStats {
    try await computer("/computer/stats")
  }

  // The update waiting on this person's computer, or nothing.
  func computerUpdate() async throws -> ImageUpdate? {
    let data = try await ask("/computer/update")
    let said = String(decoding: data, as: UTF8.self)
    if said.isEmpty || said == "null" { return nil }
    return try JSONDecoder().decode(ImageUpdate.self, from: data)
  }

  // The person taking it: the machine restarts onto the new image.
  func takeUpdate() async throws {
    _ = try await ask("/computer/update", method: "POST")
  }

  func computerBackups() async throws -> ComputerBackups {
    try await computer("/computer/backups")
  }

  // One backup brought back into a folder of its own, whose name is the
  // answer; nothing is ever written over.
  func restoreBackup(_ key: String) async throws -> String {
    struct Landing: Decodable { var name: String }
    let landing: Landing = try await computer(
      "/computer/backups", method: "POST", json: ["key": key])
    return landing.name
  }

  // The move, which only the person starts; the region is a form field, as
  // the door's own page sends it.
  func moveComputer(to region: String) async throws {
    _ = try await ask("/computer/move", method: "POST", form: ["region": region])
  }

  // The Linux thrown away and made again, the home kept.
  func resetComputer() async throws {
    _ = try await ask("/computer/reset", method: "POST")
  }

  // The round trip the phone itself measures to the computer's own door:
  // the shortest of a few trips after one to open the connection, in
  // milliseconds. Any answer from the door counts, since the trip is what
  // is being timed.
  func roundTrip(to door: String) async throws -> Int {
    let host = door.replacingOccurrences(of: "wss://", with: "https://")
    guard let url = URL(string: host + "/maslow/health") else {
      throw ComputerRefused(said: "The computer's address could not be read.")
    }
    var best = Double.infinity
    for trip in 0...5 {
      var request = URLRequest(url: url)
      request.cachePolicy = .reloadIgnoringLocalCacheData
      let at = ContinuousClock.now
      do {
        _ = try await URLSession.shared.data(for: request)
      } catch {
        throw ComputerRefused(said: "The round trip could not be measured: \(error.localizedDescription)")
      }
      let took = at.duration(to: .now)
      let ms = Double(took.components.seconds) * 1000
        + Double(took.components.attoseconds) / 1e15
      if trip > 0 { best = min(best, ms) }
    }
    return Int(best.rounded())
  }

  private func computer<T: Decodable>(
    _ path: String, method: String = "GET", json: [String: any Sendable]? = nil
  ) async throws -> T {
    try JSONDecoder().decode(T.self, from: await ask(path, method: method, json: json))
  }

  // One ask of a computer door, with the session as a bearer token. These
  // doors answer a sentence when they refuse and a redirect when a thing
  // was started, so the body is only read on the way to an error.
  private func ask(
    _ path: String, method: String = "GET", json: [String: any Sendable]? = nil,
    form: [String: String]? = nil
  ) async throws -> Data {
    var request = URLRequest(url: server.appending(path: path))
    request.httpMethod = method
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    if let json {
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONSerialization.data(withJSONObject: json)
    }
    if let form {
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
      var fields = URLComponents()
      fields.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
      request.httpBody = Data((fields.percentEncodedQuery ?? "").utf8)
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw API.Failure.unreachable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    switch status {
    case 200..<300: return data
    case 401: throw API.Failure.signedOut
    default:
      let said = String(decoding: data, as: UTF8.self)
      throw said.isEmpty ? API.Failure.status(status) : ComputerRefused(said: said)
    }
  }
}

// Where a computer can be: the seven places in North America Fly still
// makes disks in.
nonisolated enum ComputerRegions {
  static let regions = [
    "iad": "Ashburn", "ord": "Chicago", "dfw": "Dallas", "lax": "Los Angeles",
    "ewr": "Newark", "sjc": "San Jose", "yyz": "Toronto",
  ]

  static let codes = ["iad", "ord", "dfw", "lax", "ewr", "sjc", "yyz"]

  // A round trip feels like a terminal under this many milliseconds.
  static let budgetMs = 40

  static func region(_ code: String) -> String { regions[code] ?? code }
}

// How far each step of the making has got and what it says, the region's
// name going where the blank is.
nonisolated enum ComputerSteps {
  static let making: [String: (Double, String)] = [
    "off": (0, "Computers are off here"),
    "disk": (0.15, "Making your disk"),
    "machine": (0.45, "Making your machine"),
    "starting": (0.75, "Starting it up"),
    "moving": (0, "Moving it"),
    "ready": (1, "Ready"),
  ]

  static let moving: [String: (Double, String)] = [
    "stopping": (0.1, "Stopping it"),
    "copying": (0.3, "Copying its disk"),
    "restoring": (0.55, "Restoring the copy in _"),
    "starting": (0.8, "Starting it in _ and checking it answers"),
    "clearing": (0.95, "Clearing away the old one"),
  ]
}

// The computer this phone is looking at: everything the pane shows, asked
// for while the pane is on screen and nowhere kept. Nothing durable lives
// here — the machine and the server hold it all, and this is a view onto
// them.
@Observable
final class Machine {
  var state: MachineState?
  var stats: MachineStats?
  var about: About?
  var update: ImageUpdate?
  var backups: ComputerBackups?
  // The round trip to the door in milliseconds, and what stopped it being
  // measured.
  var trip: Int?
  var tripFailed: String?
  // What the last ask that failed said, kept until one lands.
  var failed: String?
  // What the last thing the person asked for did, in its own words.
  var said: String?
  var busy = false
  // When a restart was asked for. The machine stays ready for the half
  // minute it takes to stop, so "ready" inside that window is the old
  // machine speaking and is not believed.
  private var restartingAt: ContinuousClock.Instant?

  var ready: Bool { state?.ready == true }

  // The making, or a move, one step further on, then the numbers: asked
  // every five seconds for as long as the pane is on screen.
  func watch(_ api: API) async {
    while !Task.isCancelled {
      await look(api)
      try? await Task.sleep(for: .seconds(ready ? 5 : 3))
    }
  }

  func look(_ api: API) async {
    do {
      let now = try await api.computerState()
      if now.ready, let asked = restartingAt, asked.duration(to: .now) < .seconds(60) {
        return
      }
      restartingAt = nil
      state = now
      failed = nil
      if now.ready { await numbers(api) }
    } catch {
      failed = error.localizedDescription
    }
  }

  // What the ready machine is using, the update waiting on it, and its
  // facts; each named on screen when it will not answer.
  private func numbers(_ api: API) async {
    do {
      stats = try await api.computerStats()
    } catch {
      stats = nil
      failed = error.localizedDescription
    }
    update = try? await api.computerUpdate()
    if about == nil { about = try? await api.about() }
    if backups == nil || backups?.restoring?.landed == false { await kept(api) }
    if trip == nil { await measure(api) }
  }

  func kept(_ api: API) async {
    do {
      backups = try await api.computerBackups()
    } catch {
      failed = error.localizedDescription
    }
  }

  // The trip to the door, tried again on every look until one lands; what
  // stopped the last try stands in its place meanwhile.
  private func measure(_ api: API) async {
    do {
      let live = try await api.live()
      trip = try await api.roundTrip(to: live.door)
      tripFailed = nil
    } catch {
      tripFailed = error.localizedDescription
    }
  }

  // Something the person asked for: the answer is theirs to read, and a
  // refusal is said in the door's own words.
  func doing(_ api: API, _ act: (API) async throws -> String?) async {
    busy = true
    said = nil
    failed = nil
    defer { busy = false }
    do {
      said = try await act(api)
      await look(api)
    } catch {
      failed = error.localizedDescription
    }
  }

  // A restart the person asked for: the pane turns to the bar watching it
  // come back the moment it is asked for, not when the answer lands.
  func restarting() {
    restartingAt = .now
    state?.progress = "starting"
    stats = nil
    update = nil
  }
}
