import SwiftUI
import UIKit

// The Terminal: the machine's tmux session, live. What the person types
// goes to their computer as they type it, the keys a phone's keyboard
// lacks are a strip above the keyboard, and the session's windows are a
// sheet away. Closing this kills nothing: tmux holds the session, so
// coming back finds it as it was.
struct TerminalView: View {
  @Environment(Session.self) private var session
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.openURL) private var openURL
  @State private var talk = Talk()
  @State private var shells = false

  var body: some View {
    Emulator(talk: talk)
      .preferredColorScheme(.dark)
      .navigationTitle("Terminal")
      .navigationSubtitle(talk.away ?? "")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem {
          Button("Shells", systemImage: "square.stack") { shells = true }
        }
      }
      .safeAreaInset(edge: .bottom) { strip }
      .sheet(isPresented: $shells) { Shells(talk: talk) }
      .alert(
        "Your computer asked to open", isPresented: offering, presenting: talk.offer
      ) { offer in
        if let address = offer.address {
          Button("Open") { openURL(address) }
          Button("Copy the address") { UIPasteboard.general.string = offer.said }
        }
        Button("Not now", role: .cancel) {}
      } message: { offer in
        Text(
          offer.pasteback
            ? "\(offer.said)\n\nSign in on this phone. At the end it shows a code: copy it, come back here, and paste it at the prompt."
            : offer.said)
      }
      .alert("That didn't happen", isPresented: refusing) {
        Button("OK") {}
      } message: {
        Text(talk.refused ?? "")
      }
      .sensoryFeedback(.success, trigger: talk.joins)
      .sensoryFeedback(.error, trigger: talk.refused)
      .task { await talk.run(session) }
  }

  // The keys a shell needs that a phone's keyboard has not: each sent as
  // the terminal would send it, Ctrl arming the next letter typed and
  // Paste sending what is on this device's clipboard.
  private var strip: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(Self.keys) { key in
          Button { talk.type(Data(key.said.utf8)) } label: { Cap(key.label) }
            .buttonStyle(.glass)
            .accessibilityLabel(key.named)
        }
        Button {
          withAnimation(reduceMotion ? .smooth(duration: 0.2) : .snappy) {
            talk.control.toggle()
          }
        } label: {
          Cap("Ctrl")
        }
        .buttonStyle(.glass(talk.control ? .regular.tint(.accentColor) : .regular))
        .accessibilityLabel("Control, for the next letter")
        .accessibilityValue(talk.control ? "armed" : "off")
        Button {
          guard let words = UIPasteboard.general.string else { return }
          talk.type(Data(words.utf8))
        } label: {
          Cap("Paste")
        }
        .buttonStyle(.glass)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
    }
    .scrollIndicators(.hidden)
  }

  private var offering: Binding<Bool> {
    Binding { talk.offer != nil } set: { shown in if !shown { talk.dismiss() } }
  }

  private var refusing: Binding<Bool> {
    Binding { talk.refused != nil } set: { shown in if !shown { talk.refused = nil } }
  }

  // The keys, as the terminal sends them.
  private static let keys: [Key] = [
    Key(label: "Esc", said: "\u{1b}", named: "Escape"),
    Key(label: "Tab", said: "\t", named: "Tab"),
    Key(label: "↑", said: "\u{1b}[A", named: "Up"),
    Key(label: "↓", said: "\u{1b}[B", named: "Down"),
    Key(label: "←", said: "\u{1b}[D", named: "Left"),
    Key(label: "→", said: "\u{1b}[C", named: "Right"),
    Key(label: "-", said: "-", named: "Minus"),
    Key(label: "/", said: "/", named: "Slash"),
    Key(label: "|", said: "|", named: "Pipe"),
    Key(label: "~", said: "~", named: "Tilde"),
  ]

  private struct Key: Identifiable {
    let label: String
    let said: String
    let named: String
    var id: String { label }
  }
}

// One key of the strip, at a size a finger hits.
private struct Cap: View {
  let label: String

  init(_ label: String) {
    self.label = label
  }

  var body: some View {
    Text(label)
      .font(.body)
      .monospaced()
      .frame(minWidth: 44, minHeight: 44)
  }
}

// The session's windows, as the door lists them: the one in view marked, a
// tap turns this terminal to it, and the plus opens another. Renaming and
// closing are the row's own.
private struct Shells: View {
  let talk: Talk
  @Environment(\.dismiss) private var dismiss
  @State private var renaming: Shell?
  @State private var name = ""

  var body: some View {
    NavigationStack {
      List {
        ForEach(talk.shells) { shell in
          Button {
            talk.select(shell.index)
            dismiss()
          } label: {
            LabeledContent {
              if shell.on {
                Image(systemName: "checkmark").foregroundStyle(.tint)
              }
            } label: {
              Label(shell.shown, systemImage: "apple.terminal")
            }
          }
          .buttonStyle(.plain)
          .swipeActions(edge: .trailing) {
            if talk.shells.count > 1 {
              Button("Close", systemImage: "xmark", role: .destructive) {
                talk.close(shell.index)
              }
            }
            Button("Rename", systemImage: "pencil") {
              name = shell.shown
              renaming = shell
            }
          }
          .contextMenu {
            Button("Rename", systemImage: "pencil") {
              name = shell.shown
              renaming = shell
            }
            if talk.shells.count > 1 {
              Button("Close", systemImage: "xmark", role: .destructive) {
                talk.close(shell.index)
              }
            }
          }
        }
      }
      .overlay {
        if talk.shells.isEmpty {
          ContentUnavailableView(
            "No shells yet", systemImage: "apple.terminal",
            description: Text("Your computer hasn't listed them."))
        }
      }
      .navigationTitle("Shells")
      .toolbar {
        ToolbarItem {
          Button("New shell", systemImage: "plus") {
            talk.fresh()
            dismiss()
          }
        }
      }
      .alert("Rename this shell", isPresented: naming) {
        TextField("Name", text: $name)
        Button("Rename") {
          let named = name.trimmingCharacters(in: .whitespaces)
          if let shell = renaming, !named.isEmpty { talk.rename(shell.index, to: named) }
          renaming = nil
        }
        Button("Cancel", role: .cancel) { renaming = nil }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var naming: Binding<Bool> {
    Binding { renaming != nil } set: { shown in if !shown { renaming = nil } }
  }
}
