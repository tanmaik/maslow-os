import PhotosUI
import SwiftUI

// What the person says next: the big button they hold to talk, the field
// their words land in with the keyboard one tap away, what they are
// handing over, and under it how the agent acts, the week's spend and how
// full the conversation is.

// The one model this computer's agent runs on, named here and nowhere
// else, since the key answers to nothing else.
private let model = "GLM 5.3 Flash"

// How the agent acts, in the composer's words and in the protocol's.

struct ComposerView: View {
  let chat: Chat?
  let ear: Ear
  let held: Attachments
  let spend: Spend?
  let api: API
  // Why there is no agent to talk to, when there is none.
  let away: String?
  // Why something the person tried did not happen.
  let refused: String?
  let send: ([PromptPart]) -> Void
  let onStop: () -> Void

  @Binding var typed: String
  @FocusState private var typing: Bool
  @State private var base = ""
  @State private var sent = 0
  @State private var picking = false
  @State private var browsing = false
  @State private var chosen: [PhotosPickerItem] = []
  @State private var shown: String?

  private var running: Bool { chat?.running ?? false }
  private var why: String? { ear.why ?? held.why ?? refused }

  var body: some View {
    VStack(spacing: 10) {
      if !held.held.isEmpty {
        HeldStrip(held: held.held) { held.remove($0) }
      }
      HStack(spacing: 8) {
        Menu {
          Button("Photos", systemImage: "photo") { picking = true }
          Button("Files", systemImage: "folder") { browsing = true }
        } label: {
          Image(systemName: "paperclip")
            .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.glass)
        .accessibilityLabel("Attach")

        TextField(away ?? "Ask your agent to do something", text: $typed, axis: .vertical)
          .lineLimit(1...4)
          .focused($typing)
          .submitLabel(.send)
          .onSubmit { say(typed) }
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(.fill.quaternary, in: .capsule)
          .disabled(away != nil)

        if running {
          Button("Stop", systemImage: "stop.fill") { onStop() }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .frame(minWidth: 44, minHeight: 44)
        } else if !typed.trimmingCharacters(in: .whitespaces).isEmpty {
          Button("Send", systemImage: "arrow.up") { say(typed) }
            .labelStyle(.iconOnly)
            .buttonStyle(.glassProminent)
            .frame(minWidth: 44, minHeight: 44)
        }
      }
      HoldToTalk(ear: ear, note: away, onHold: hold, onRelease: release, onCancel: drop)
      if let shown {
        Text(shown)
          .font(.caption)
          .foregroundStyle(.red)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      status
    }
    .padding(.horizontal, 16)
    .padding(.top, 10)
    .padding(.bottom, 4)
    .sensoryFeedback(.success, trigger: sent)
    .task(id: why) { await name(why) }
    .onChange(of: chat?.id) { shown = nil }
    // The words as they are heard, in the field beside anything typed
    // before the hold began.
    .onChange(of: ear.heard) {
      guard ear.on else { return }
      typed = join(base, ear.heard)
    }
    .photosPicker(isPresented: $picking, selection: $chosen, matching: .images)
    .onChange(of: chosen) {
      let items = chosen
      chosen = []
      Task { await take(items) }
    }
    .fileImporter(isPresented: $browsing, allowedContentTypes: [.item], allowsMultipleSelection: true) { picked in
      switch picked {
      case .success(let urls): Task { await take(urls) }
      case .failure(let error): held.blame(error.localizedDescription)
      }
    }
  }

  // The week's spend and how full the conversation is: the numbers under
  // the words.
  private var status: some View {
    HStack(spacing: 10) {
      Text(model)
        .font(.caption)
        .foregroundStyle(.tertiary)
      Spacer(minLength: 0)
      if let spend {
        Text(spend.said)
          .font(.caption)
          .foregroundStyle(spend.reached ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
      }
      if let context = chat?.context {
        Text("\(Int(context.full * 100))% full")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
    }
    .frame(minHeight: 22)
  }

  // Why something did not happen, said under the button it belongs to and
  // gone a few seconds later, so nothing red outlives what it is about.
  private func name(_ said: String?) async {
    shown = said
    guard said != nil else { return }
    try? await Task.sleep(for: .seconds(6))
    if !Task.isCancelled { shown = nil }
  }


  private func hold() {
    base = typed
    Task { await ear.start() }
  }

  // Let go and the words go, when the hold is all there was; where
  // something was already typed they join it and wait for Send.
  private func release() {
    Task {
      let heard = await ear.stop()
      let typedFirst = !base.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      let words = join(base, heard)
      base = ""
      if typedFirst {
        typed = words
        return
      }
      typed = ""
      if !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { say(words) }
    }
  }

  private func drop() {
    ear.cancel()
    typed = base
    base = ""
  }

  // What the person said, sent as a prompt: their words and whatever they
  // attached, once every file has landed.
  private func say(_ words: String) {
    let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
    guard away == nil, !(text.isEmpty && held.parts.isEmpty) else { return }
    guard held.ready else {
      return held.blame("That file is still landing on your computer.")
    }
    var prompt = held.parts
    if !text.isEmpty { prompt.append(.text(text)) }
    typed = ""
    base = ""
    held.clear()
    sent += 1
    send(prompt)
  }

  private func take(_ items: [PhotosPickerItem]) async {
    for item in items {
      guard let data = try? await item.loadTransferable(type: Data.self) else {
        held.blame("That picture could not be read.")
        continue
      }
      let type = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
      held.add(picture: data, named: "Photo", type: type)
    }
  }

  private func take(_ urls: [URL]) async {
    for url in urls {
      let open = url.startAccessingSecurityScopedResource()
      defer { if open { url.stopAccessingSecurityScopedResource() } }
      guard let data = try? Data(contentsOf: url) else {
        held.blame("\(url.lastPathComponent) could not be read.")
        continue
      }
      await held.add(file: data, named: url.lastPathComponent, with: api)
    }
  }
}

// Words heard put after what was typed, with a space between where one is
// missing.
private func join(_ typed: String, _ heard: String) -> String {
  guard !heard.isEmpty else { return typed }
  if typed.isEmpty { return heard }
  return typed.hasSuffix(" ") ? typed + heard : typed + " " + heard
}
