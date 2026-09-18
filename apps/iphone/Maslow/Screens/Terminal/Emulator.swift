import SwiftTerm
import SwiftUI
import UIKit

// The machine's terminal as it is drawn: SwiftTerm's emulator, fed the
// door's bytes, sending every keystroke back, and telling the door how
// many cells it is whenever its size changes. Dark, monospaced at the
// footnote size, so a shell's lines fit the width, edge to edge.
struct Emulator: UIViewRepresentable {
  let talk: Talk

  func makeUIView(context: UIViewRepresentableContext<Emulator>) -> SwiftTerm.TerminalView {
    let screen = SwiftTerm.TerminalView(frame: .zero)
    screen.terminalDelegate = context.coordinator
    // The keys a phone's keyboard lacks are the screen's own strip, not
    // SwiftTerm's.
    screen.inputAccessoryView = nil
    screen.overrideUserInterfaceStyle = .dark
    screen.nativeBackgroundColor = .systemBackground
    screen.nativeForegroundColor = .label
    screen.caretColor = .label
    screen.backgroundColor = .systemBackground
    screen.font = .monospacedSystemFont(
      ofSize: UIFont.preferredFont(forTextStyle: .footnote).pointSize, weight: .regular)
    talk.draw = { [weak screen] bytes in screen?.feed(byteArray: bytes) }
    talk.clear = { [weak screen] in screen?.getTerminal().resetToInitialState() }
    // The keyboard is up the moment the terminal is, since a terminal with
    // no keys is a picture.
    Task { screen.becomeFirstResponder() }
    return screen
  }

  func updateUIView(
    _ screen: SwiftTerm.TerminalView, context: UIViewRepresentableContext<Emulator>
  ) {}

  func makeCoordinator() -> Coordinator {
    Coordinator(talk)
  }

  // SwiftTerm speaks to its host on the main thread; the protocol is not
  // isolated, so each word is taken back onto the actor it arrived on.
  final class Coordinator: NSObject, TerminalViewDelegate {
    private let talk: Talk

    init(_ talk: Talk) {
      self.talk = talk
    }

    nonisolated func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
      MainActor.assumeIsolated { talk.type(Data(data)) }
    }

    nonisolated func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
      MainActor.assumeIsolated { talk.resize(cols: newCols, rows: newRows) }
    }

    nonisolated func requestOpenLink(
      source: SwiftTerm.TerminalView, link: String, params: [String: String]
    ) {
      MainActor.assumeIsolated {
        guard let address = URL(string: link) else { return }
        UIApplication.shared.open(address)
      }
    }

    // Words picked on the machine land on this device's clipboard.
    nonisolated func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
      MainActor.assumeIsolated {
        UIPasteboard.general.string = String(decoding: content, as: UTF8.self)
      }
    }

    nonisolated func clipboardRead(source: SwiftTerm.TerminalView) -> Data? {
      MainActor.assumeIsolated { UIPasteboard.general.string.map { Data($0.utf8) } }
    }

    nonisolated func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(
      source: SwiftTerm.TerminalView, directory: String?
    ) {}
    nonisolated func scrolled(source: SwiftTerm.TerminalView, position: Double) {}
    nonisolated func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {}
  }
}
