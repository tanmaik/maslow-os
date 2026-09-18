import Foundation
import Observation
import SwiftUI
import UIKit

// The machine's own browser, in hand: one socket to the door's View path
// carries its picture down and the person's taps, drags, scrolls and typed
// keys up. Nothing of it lives on the phone — the machine holds the
// browser, its tabs and its pages — so a socket that closes is reopened a
// second later and everything is there, and the ticket is taken again
// before its hour is out.
@Observable @MainActor final class Browser {
  nonisolated enum Phase: Equatable, Sendable {
    case asking
    case open
    case closed
    case failed(String)
  }

  // What to say of the last hand, and whether it went well.
  nonisolated struct Note: Equatable, Sendable {
    var text: String
    var ok: Bool
  }

  // One tab of the machine's browser, as the door lists it.
  nonisolated struct Tab: Identifiable, Equatable, Sendable {
    var id: Int
    var title: String
    var url: String
    // What to call it in a list: its title, else its address.
    var name: String {
      if !title.isEmpty { return title }
      return url == "about:blank" || url.isEmpty ? "New tab" : url
    }
  }

  private(set) var phase: Phase = .asking
  private(set) var tabs: [Tab] = []
  private(set) var current: Int?
  // The size the picture arrives at, which is the size a tap is measured
  // in: the machine says it as the socket opens and whenever it changes.
  private(set) var shot = CGSize(width: 1280, height: 800)
  // The page's own cursor under the pointer, for a phone with one on it.
  private(set) var cursor = "default"
  // What came of the last hand: the words a copy took, or why it could not.
  var note: Note?
  // The address bar, which follows the tab shown unless the person is in
  // the middle of typing one.
  var address = ""
  var typing = false
  let picture = Picture()

  private let api: API
  private var socket: DoorSocket?
  private var runner: Task<Void, Never>?
  private var sending: Task<Void, Never>?
  private var settling: Task<Void, Never>?
  private var seq = 0
  // What the page has already been told of what is in the typing field.
  private var was = ""
  // The size the machine was last told to draw the page at.
  private var told: CGSize?
  private var pane: CGSize?
  private var watching = true

  // A ticket lives an hour; the socket is taken down before it lapses so
  // the next one is opened on a fresh one.
  private static let ticketLasts = Duration.seconds(50 * 60)

  // The narrowest page the machine's browser will draw: asked for less it
  // widens to this on its own, so a pane narrower than it is asked for in
  // its own shape, grown until it fits.
  private static let narrowest: CGFloat = 640

  init(api: API) {
    self.api = api
    picture.broken = { [weak self] why in self?.note = Note(text: why, ok: false) }
  }

  func start() {
    guard runner == nil else { return }
    runner = Task { await run() }
  }

  func stop() {
    runner?.cancel()
    runner = nil
    socket?.close()
    socket = nil
  }

  private func run() async {
    while !Task.isCancelled {
      do {
        let live = try await api.live()
        let socket = try await DoorSocket(live, path: "/maslow/view")
        self.socket = socket
        phase = .asking
        note = nil
        picture.restart()
        watch(watching)
        if let pane { report(pane) }
        let ping = Task {
          while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            try? await socket.send(json: ["ping": Date.now.timeIntervalSince1970])
          }
        }
        let hour = Task {
          try? await Task.sleep(for: Self.ticketLasts)
          socket.close()
        }
        for await frame in socket.frames {
          switch frame {
          case .text(let text): heard(text)
          case .data(let data): picture.feed(data)
          }
        }
        ping.cancel()
        hour.cancel()
        self.socket = nil
        if Task.isCancelled { return }
        phase = .failed("Your computer's door stopped answering. Trying again.")
        try? await Task.sleep(for: .seconds(1))
      } catch {
        socket = nil
        phase = .failed(error.localizedDescription)
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  // What the door says in words.
  private func heard(_ text: String) {
    guard let word = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
    else { return }
    if let size = word["size"] as? [String: Any], let w = size["w"] as? Double,
      let h = size["h"] as? Double
    {
      let now = CGSize(width: w, height: h)
      guard now != shot else { return }
      shot = now
      picture.restart()
      restream()
    } else if let open = word["browser"] as? String {
      phase = open == "open" ? .open : .closed
    } else if let listed = word["tabs"] as? [[String: Any]] {
      tabs = listed.compactMap { tab in
        guard let id = tab["id"] as? Int else { return nil }
        return Tab(
          id: id, title: tab["title"] as? String ?? "", url: tab["url"] as? String ?? "")
      }
      current = word["current"] as? Int
      if phase == .asking && current != nil { phase = .open }
      if !typing, let shown = tabs.first(where: { $0.id == current }) {
        address = shown.url == "about:blank" ? "" : shown.url
      }
    } else if let wants = word["cursor"] as? String {
      cursor = wants
    } else if word["id"] != nil {
      if let why = word["why"] as? String {
        note = Note(text: why, ok: false)
      } else if let words = word["copy"] as? String {
        took(words)
      }
    }
  }

  // The words the last drag selected, into the person's own clipboard.
  private func took(_ words: String) {
    guard !words.isEmpty else {
      note = Note(
        text: "Nothing is selected. Press and hold, then drag across the words.", ok: false)
      return
    }
    UIPasteboard.general.string = words
    note = Note(
      text: "Copied \(words.count) character\(words.count == 1 ? "" : "s").", ok: true)
  }

  // A word to the door, after whatever was said before it: a copy asked
  // for right after a selection has to reach the browser in that order.
  // With no socket there is nothing to say it to, and the pane itself says
  // the door is not answering; what the machine needs is said again the
  // moment a socket opens.
  private func tell(_ word: [String: any Sendable]) {
    guard let socket else { return }
    let before = sending
    sending = Task {
      await before?.value
      try? await socket.send(json: word)
    }
  }

  // A hand on the browser, numbered so its answer finds who asked.
  private func act(_ what: [String: any Sendable]) {
    seq += 1
    tell(["act": what, "id": seq])
  }

  // Video flows only while the person is looking; asking for it again
  // starts a stream from a key frame.
  func watch(_ on: Bool) {
    watching = on
    if on { picture.restart() }
    tell(["view": on])
  }

  // The stream a size change left behind still carries the old size's
  // pictures, and a page that does not change makes no new one: asked for
  // again, the door gives this viewer a fresh encoder whose first frame is
  // a whole picture at the size it just announced.
  private func restream() {
    guard watching else { return }
    tell(["view": false])
    tell(["view": true])
  }

  func go(to address: String) {
    let url = address.trimmingCharacters(in: .whitespaces)
    guard !url.isEmpty else { return }
    note = nil
    act(["kind": "navigate", "url": url])
  }

  func back() { act(["kind": "back"]) }
  func forward() { act(["kind": "forward"]) }
  func reload() { act(["kind": "reload"]) }
  func tap(_ at: CGPoint) { act(["kind": "click", "x": Int(at.x), "y": Int(at.y)]) }
  func scroll(_ at: CGPoint, by dy: CGFloat) {
    act(["kind": "scroll", "x": Int(at.x), "y": Int(at.y), "dy": Int(dy)])
  }
  func type(_ text: String) { act(["kind": "type", "text": text]) }
  func press(_ key: String) { act(["kind": "key", "key": key]) }
  func move(_ at: CGPoint) {
    let hand: [String: any Sendable] = ["kind": "move", "x": Int(at.x), "y": Int(at.y)]
    tell(["act": hand])
  }
  func leave() {
    let hand: [String: any Sendable] = ["kind": "leave"]
    tell(["act": hand])
  }

  // What the person typed into the page, as they type it: what they added
  // goes as words, what they took back as backspaces.
  func typed(_ now: String) {
    let shared = zip(was, now).prefix { $0 == $1 }.count
    for _ in 0..<(was.count - shared) { press("Backspace") }
    let added = String(now.dropFirst(shared))
    if !added.isEmpty { type(added) }
    was = now
  }

  // The field emptied by a Return or a Done, which the page never hears:
  // what it held is already in the page.
  func clearTyping() { was = "" }

  func copy() { act(["kind": "copy"]) }

  // A press and drag across words selects them, and the words are asked
  // for at once so they are in the clipboard by the time the finger lifts.
  func select(from: CGPoint, to: CGPoint) {
    act([
      "kind": "select", "x": Int(from.x), "y": Int(from.y), "x2": Int(to.x), "y2": Int(to.y),
    ])
    copy()
  }

  func show(tab id: Int) { tell(["tab": id]) }
  func newTab() { tell(["newTab": true]) }
  func close(tab id: Int) { tell(["closeTab": id]) }

  // The pane's shape in the page's own pixels, told to the machine once a
  // layout settles, so the page is laid out no wider than it has to be and
  // the picture fills the pane edge to edge. Even numbers, since the video
  // it becomes is made in pairs of pixels.
  func settle(pane size: CGSize) {
    let grown = max(1, Self.narrowest / max(size.width, 1))
    let pixels = CGSize(
      width: (size.width * grown / 2).rounded() * 2,
      height: (size.height * grown / 2).rounded() * 2)
    guard pixels.width >= 2, pixels.height >= 2, pixels != told else { return }
    pane = pixels
    settling?.cancel()
    settling = Task {
      try? await Task.sleep(for: .milliseconds(200))
      guard !Task.isCancelled else { return }
      report(pixels)
    }
  }

  private func report(_ pixels: CGSize) {
    told = pixels
    tell(["size": ["w": Int(pixels.width), "h": Int(pixels.height)]])
  }

  // How far a finger's travel carries the page: the picture's own pixels,
  // which are the pane's own until the machine draws at another size.
  func over(_ distance: CGFloat, in pane: CGSize) -> CGFloat {
    let scale = min(pane.width / shot.width, pane.height / shot.height)
    return scale > 0 ? distance / scale : distance
  }

  // Where a point on the pane falls on the picture, in the browser's own
  // pixels: the picture keeps its shape inside the pane, centred, and a
  // point outside it is the nearest edge.
  func at(_ point: CGPoint, in pane: CGSize) -> CGPoint {
    let scale = min(pane.width / shot.width, pane.height / shot.height)
    guard scale > 0 else { return .zero }
    let left = (pane.width - shot.width * scale) / 2
    let top = (pane.height - shot.height * scale) / 2
    let inside = { (n: CGFloat, most: CGFloat) in min(most, max(0, n.rounded())) }
    return CGPoint(
      x: inside((point.x - left) / scale, shot.width),
      y: inside((point.y - top) / scale, shot.height))
  }
}
