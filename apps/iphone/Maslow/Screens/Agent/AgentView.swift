import SwiftUI

// The Agent: the person's Claude Code on their computer, over the door's
// own socket. One conversation is in view and the rest stand open behind
// it; the thread is the door's record, replayed to this phone every time
// it connects, and nothing of it is kept here.

// Which conversations the person pinned to the top of the list: the
// device's to remember, as the desk remembers its own.
private let pinsKept = "agent-pins"

struct AgentView: View {
  @Environment(Session.self) private var session
  @Environment(\.scenePhase) private var phase

  @State private var chats = Chats()
  @State private var ear = Ear()
  @State private var held = Attachments()
  @State private var here: String?
  @State private var typed = ""
  @State private var title = "New conversation"
  @State private var spend: Spend?
  @State private var listing = false
  @State private var pins: [String] = UserDefaults.standard.stringArray(forKey: pinsKept) ?? []
  // Words said before there was a conversation to say them to, sent the
  // moment one opens.
  @State private var waiting: [PromptPart]?

  private var chat: Chat? { here.flatMap { chats.chats[$0] } }

  // The conversation's name as the door has it: the word it sent for this
  // chat, or the name on its row in the door's own list.
  private var name: String {
    chat?.title ?? chats.past.first { $0.sessionId == here }?.title ?? "New conversation"
  }

  var body: some View {
    NavigationStack {
      thread
        .navigationTitle($title)
        .toolbarTitleDisplayMode(.inline)
        .task(id: session.held?.token) {
          ear.api = session.api
          ear.warm()
        }
        .onDisappear { ear.rest() }
        .toolbar {
          ToolbarItem(placement: .topBarLeading) {
            Button("Conversations", systemImage: "list.bullet") { listing = true }
          }
          ToolbarItem(placement: .topBarTrailing) {
            Button("New conversation", systemImage: "square.and.pencil") { begin() }
          }
        }
        .safeAreaBar(edge: .bottom) {
          ComposerView(
            chat: chat, ear: ear, held: held, spend: spend, api: session.api,
            away: chats.away, refused: chats.refused, send: say,
            onStop: { if let id = here { chats.stop(id) } },
            typed: $typed)
        }
        .sheet(isPresented: $listing) {
          Conversations(
            chats: chats, past: chats.past, here: here, pins: $pins,
            onOpen: { open($0) }, onNew: { begin() })
        }
    }
    .task { await chats.run(session.api) }
    .task {
      // The week's spend, read once a minute, as the desk reads it.
      while !Task.isCancelled {
        spend = try? await session.api.spend()
        try? await Task.sleep(for: .seconds(60))
      }
    }
    // iOS lets an idle socket go while the app is away; coming back takes
    // a fresh ticket and the door's replay.
    .onChange(of: phase) { if phase == .active { chats.rouse() } }
    // A conversation this phone asked for, handed over the moment the
    // door has it, with anything said while it was being made.
    .onChange(of: chats.newest) {
      guard let id = chats.newest else { return }
      here = id
      if let prompt = waiting {
        waiting = nil
        chats.send(prompt, to: id)
      }
    }
    // With nothing chosen, the conversation last worked on, as a phone
    // opens where it left off.
    .onChange(of: chats.past.first?.sessionId) {
      guard here == nil, let last = chats.past.first?.sessionId else { return }
      open(last)
    }
    .onChange(of: name) { title = name }
    // The name the person typed over the title, kept by the door.
    .onChange(of: title) {
      let named = title.trimmingCharacters(in: .whitespacesAndNewlines)
      guard let id = here, !named.isEmpty, named != name, named != "New conversation"
      else { return }
      chats.name(id, named)
    }
  }

  @ViewBuilder private var thread: some View {
    if let chat {
      ThreadView(
        chat: chat, wrote: chats.wrote,
        onAllow: { ask, option in chats.allow(ask, option, in: chat.id) },
        onAnswer: { ask, said in chats.answer(ask, said, in: chat.id) })
    } else if let away = chats.away {
      ContentUnavailableView {
        Label("Your agent", systemImage: "sparkles")
      } description: {
        Text(away)
      }
    } else {
      ContentUnavailableView {
        Label("Your agent", systemImage: "sparkles")
      } description: {
        Text("Hold the button and say what you want done.")
      }
    }
  }

  private func open(_ id: String) {
    guard id != here else { return }
    chats.open(id)
    here = id
  }

  private func begin() {
    here = nil
    typed = ""
    chats.begin()
  }

  // What the person said. With no conversation open yet, one is made for
  // it and the words wait the moment it takes.
  private func say(_ prompt: [PromptPart]) {
    if let id = here {
      chats.send(prompt, to: id)
    } else {
      waiting = prompt
      chats.begin()
    }
  }
}

// Every conversation the machine keeps, pinned ones first: one to open, a
// name to change, and one to close and free its process.
private struct Conversations: View {
  let chats: Chats
  let past: [PastChat]
  let here: String?
  @Binding var pins: [String]
  let onOpen: (String) -> Void
  let onNew: () -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        if !pinned.isEmpty {
          Section("Pinned") { rows(pinned) }
        }
        Section(pinned.isEmpty ? "" : "Recent") { rows(rest) }
      }
      .navigationTitle("Conversations")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("New", systemImage: "square.and.pencil") {
            onNew()
            dismiss()
          }
        }
      }
      .overlay {
        if past.isEmpty {
          ContentUnavailableView(
            "No conversations yet", systemImage: "bubble.left.and.bubble.right",
            description: Text("Hold to talk and this phone opens one."))
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var pinned: [PastChat] { past.filter { pins.contains($0.sessionId) } }
  private var rest: [PastChat] { past.filter { !pins.contains($0.sessionId) } }

  @ViewBuilder private func rows(_ these: [PastChat]) -> some View {
    ForEach(these) { one in
      Button {
        onOpen(one.sessionId)
        dismiss()
      } label: {
        LabeledContent {
          Text(one.ago).foregroundStyle(.tertiary)
        } label: {
          Label {
            Text(chats.chats[one.sessionId]?.title ?? one.title ?? "New conversation")
              .lineLimit(1)
          } icon: {
            if one.sessionId == here {
              Image(systemName: "checkmark")
            }
          }
        }
      }
      .swipeActions(edge: .leading) {
        Button(pins.contains(one.sessionId) ? "Unpin" : "Pin", systemImage: "pin") {
          pin(one.sessionId)
        }
        .tint(.orange)
      }
      .swipeActions(edge: .trailing) {
        Button(role: .destructive) {
          chats.close(one.sessionId)
        } label: {
          Label("Close", systemImage: "xmark")
        }
      }
    }
  }

  private func pin(_ id: String) {
    pins = pins.contains(id) ? pins.filter { $0 != id } : pins + [id]
    UserDefaults.standard.set(pins, forKey: pinsKept)
  }
}
