import Foundation
import Observation

// One window of the machine's tmux session, as the door names it.
nonisolated struct Shell: Decodable, Identifiable, Hashable, Sendable {
  var index: Int
  var name: String
  var on: Bool

  var id: Int { index }

  // tmux names its own housekeeping window in brackets, which means
  // nothing to a person.
  var shown: String { name.hasPrefix("[") ? "shell" : name }
}

// Something a program on the machine asked to open, which only this device
// can reach.
nonisolated struct Offer: Identifiable, Equatable, Sendable {
  var said: String
  var address: URL?
  // A sign-in that ends in a code the person carries back by hand.
  var pasteback: Bool
  var id: String { said }
}

// The person's terminal, live: what they type goes to their computer as
// they type it, what the machine draws comes back as bytes, and the
// session's windows are the door's to list. The session is tmux's, so a
// socket that closes and comes back finds it as it was; nothing of it is
// kept here.
@Observable final class Talk {
  private(set) var shells: [Shell] = []
  // Whether the machine is on the other end, said where the person can see
  // it; nil when it is.
  private(set) var away: String? = "Connecting…"
  private(set) var offer: Offer?
  // Why something the person tried did not happen.
  var refused: String?
  // How many times this terminal has joined the session, so the screen can
  // answer a connection with a tap of its own.
  private(set) var joins = 0
  // Whether the strip's Ctrl is armed for the next letter typed.
  var control = false

  // Where the machine's bytes are drawn, and what clears the screen before
  // the session redraws itself on a new socket.
  var draw: ((ArraySlice<UInt8>) -> Void)?
  var clear: (() -> Void)?

  private var socket: DoorSocket?
  private var cols = 80
  private var rows = 24

  // Holds the socket open for as long as the screen is there: a fresh
  // ticket and a fresh socket on every attempt, since a ticket lives an
  // hour and is only ever checked as the socket opens. A socket that
  // closes is retried in a second, a ticket that is refused in five.
  func run(_ session: Session) async {
    while !Task.isCancelled {
      do {
        let live = try await session.api.live()
        let next = try await DoorSocket(
          live, path: "/maslow/talk",
          query: ["cols": String(cols), "rows": String(rows)])
        socket = next
        away = nil
        joins += 1
        // The session redraws itself whole for a client that arrives, so
        // whatever the last socket left is cleared first, and the size it
        // was opened for is told again now it is open.
        clear?()
        tell(["resize": ["cols": cols, "rows": rows]])
        for await frame in next.frames {
          switch frame {
          case .data(let bytes): draw?(ArraySlice(bytes))
          case .text(let said): heard(said)
          }
        }
        next.close()
        socket = nil
        if Task.isCancelled { return }
        away = "Reconnecting…"
        try? await Task.sleep(for: .seconds(1))
      } catch API.Failure.signedOut {
        session.close()
        return
      } catch {
        socket = nil
        away = error.localizedDescription
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  // What the person typed, as bytes. An armed Ctrl turns the next letter
  // into its control code, since a phone's keyboard has no control key.
  func type(_ bytes: Data) {
    var bytes = bytes
    if control, bytes.count == 1, let letter = bytes.first,
      (letter | 0x20) >= 0x61, (letter | 0x20) <= 0x7a
    {
      control = false
      bytes = Data([(letter | 0x20) - 0x60])
    }
    let socket = socket
    Task { [weak self] in
      do { try await socket?.send(bytes) } catch { self?.cannot(error) }
    }
  }

  // How many cells the terminal is now, told to the door when it changes.
  func resize(cols: Int, rows: Int) {
    guard cols > 0, rows > 0, cols != self.cols || rows != self.rows else { return }
    self.cols = cols
    self.rows = rows
    tell(["resize": ["cols": cols, "rows": rows]])
  }

  func select(_ index: Int) {
    tell(["select": index])
  }

  func fresh() {
    tell(["window": "new"])
  }

  func rename(_ index: Int, to name: String) {
    tell(["rename": ["index": index, "name": name] as [String: Any]])
  }

  func close(_ index: Int) {
    tell(["close": index])
  }

  func dismiss() {
    offer = nil
  }

  // What the door says: the session's windows, and what the machine asked
  // to open.
  private func heard(_ said: String) {
    guard let heard = try? JSONDecoder().decode(Heard.self, from: Data(said.utf8)) else {
      refused = "Your computer said something this app could not read."
      return
    }
    if let shells = heard.windows { self.shells = shells }
    guard let open = heard.open else { return }
    if let address = open.address {
      let carried = forThisDevice(address)
      offer = Offer(
        said: carried, address: URL(string: carried), pasteback: endsInACode(carried))
    } else if let port = open.port {
      offer = Offer(
        said: "Port \(port) on your computer. Open it from Ports.", address: nil,
        pasteback: false)
    } else if let path = open.path {
      offer = Offer(
        said: "\(path) on your computer. Open it from Files.", address: nil, pasteback: false)
    }
  }

  private func tell(_ said: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: said) else { return }
    let text = String(decoding: data, as: UTF8.self)
    let socket = socket
    Task { [weak self] in
      do { try await socket?.send(text) } catch { self?.cannot(error) }
    }
  }

  private func cannot(_ error: any Error) {
    refused = "That didn't reach your computer: \(error.localizedDescription)"
  }

  private struct Heard: Decodable {
    var windows: [Shell]?
    var open: Opening?
  }

  // What the door asks to open: an address, or a port or a file of the
  // person's own.
  private struct Opening: Decodable {
    var address: String?
    var port: Int?
    var path: String?

    init(from decoder: any Decoder) throws {
      if let address = try? decoder.singleValueContainer().decode(String.self) {
        self.address = address
        return
      }
      let said = try decoder.container(keyedBy: Key.self)
      port = try said.decodeIfPresent(Int.self, forKey: .port)
      path = try said.decodeIfPresent(String.self, forKey: .path)
    }

    private enum Key: String, CodingKey { case port, path }
  }
}

// A sign-in whose answer would come back to a port on the machine is no
// use opened on this device: the answer would land on a page this phone
// cannot load. Claude Code offers the same sign-in in a second form that
// ends in a code to paste, and that is the one this device is given.
private func forThisDevice(_ address: String) -> String {
  guard var url = URLComponents(string: address), url.path == "/oauth/authorize",
    let items = url.queryItems,
    items.contains(where: { $0.name == "redirect_uri" && ($0.value ?? "").hasPrefix("http://localhost:") })
  else { return address }
  url.queryItems = items.filter { $0.name != "redirect_uri" && $0.name != "code" }
    + [
      URLQueryItem(name: "code", value: "true"),
      URLQueryItem(
        name: "redirect_uri", value: "https://platform.claude.com/oauth/code/callback"),
    ]
  return url.string ?? address
}

// Whether a sign-in ends in a code the person carries back by hand.
private func endsInACode(_ address: String) -> Bool {
  URLComponents(string: address)?.queryItems?.contains { $0.name == "code" && $0.value == "true" }
    ?? false
}
