import Foundation
import Observation
import WebKit

// Whose phone this is: the session the server handed over, who it opens as,
// and the orgs they may switch to. Kept in the keychain; forgotten on sign
// out, or when the server says the session is gone.
@Observable
final class Session {
  nonisolated struct Held: Codable, Sendable {
    var server: URL
    var token: String
    var person: String
    var email: String
    var orgs: [Org]
  }

  nonisolated struct Org: Codable, Identifiable, Hashable, Sendable {
    var userId: String
    var name: String
    var current: Bool
    var id: String { userId }
  }

  private(set) var held: Held?
  // Where the phone signs in, until it holds a session. Production unless
  // a debug build was pointed elsewhere on the lock screen.
  var server: URL = Session.defaultServer

  private static let key = "session"
  static let production = URL(string: "https://maslow.tech")!
  // A debug build's server, as an address typed on the lock screen or written
  // with `defaults write tech.maslow.iphone server -string <url>`. A string is
  // read as an address, never as a file path.
  // Where a debug build points: a server named when it was built, else one
  // typed on the lock screen, else production.
  static var defaultServer: URL {
    #if DEBUG
      if let named = Bundle.main.object(forInfoDictionaryKey: "MaslowServer") as? String,
        let url = URL(string: named), url.host() != nil
      {
        return url
      }
      return UserDefaults.standard.string(forKey: "server").flatMap(URL.init(string:)) ?? production
    #else
      production
    #endif
  }

  var isSignedIn: Bool { held != nil }
  var api: API { API(server: held?.server ?? server, token: held?.token) }
  var org: Org? { held?.orgs.first { $0.current } }

  static func restored() -> Session {
    let s = Session()
    if let data = Keychain.read(key), let held = try? JSONDecoder().decode(Held.self, from: data) {
      s.held = held
    }
    return s
  }

  func open(_ opened: API.Opened) {
    let held = Held(
      server: server, token: opened.token, person: opened.person, email: opened.email,
      orgs: opened.orgs)
    self.held = held
    if let data = try? JSONEncoder().encode(held) { Keychain.write(Self.key, data) }
  }

  // Forgets the session here, and the cookies any port page kept; the
  // server's copy is ended by whoever calls.
  func close() {
    held = nil
    Keychain.delete(Self.key)
    WKWebsiteDataStore.default().removeData(
      ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
  }
}
