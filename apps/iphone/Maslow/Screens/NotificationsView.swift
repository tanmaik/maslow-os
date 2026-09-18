import SwiftUI

// What waits on you: every notice newest first, a note read and cleared,
// an ask answered where it stands by picking an option or typing, and
// marked with what you said once you have.
struct NotificationsView: View {
  @Binding var waiting: Int
  @Environment(Session.self) private var session
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var loaded = Loaded<Waiting>.reading

  var body: some View {
    NavigationStack {
      Group {
        switch loaded {
        case .reading:
          ProgressView()
        case .failed(let said):
          Failed(said: said) { await load() }
        case .ready(let n):
          if n.notifications.isEmpty {
            ContentUnavailableView(
              "Nothing waiting", systemImage: "bell",
              description: Text("Your agent's notes and questions land here."))
          } else {
            List(n.notifications) { notice in
              NoticeCard(notice: notice, titles: n.titles) { answer in
                await act { try await session.api.answerNotice(notice.id, answer) }
              }
              .listRowSeparator(.hidden)
              .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
            .listStyle(.plain)
            .refreshable { await load() }
          }
        }
      }
      .navigationTitle("Waiting")
      .navigationSubtitle(waiting > 0 ? "\(waiting) to answer" : "")
      .navigationDestination(for: String.self) { RecordView(id: $0) }
      .toolbar {
        if let n = loaded.value, n.notifications.contains(where: { $0.readAt != nil && !$0.waiting }) {
          ToolbarItem(placement: .primaryAction) {
            Button("Clear read") {
              Task { await act { try await session.api.clearWaiting() } }
            }
          }
        }
      }
    }
    .task { await load() }
    .task { await watch() }
  }

  // Opening the tab is reading it: what was unread is now read.
  private func load() async {
    await act { try await session.api.readWaiting() }
  }

  // While the panel is on screen it is read every five seconds, so a note
  // or an ask left elsewhere is here within seconds.
  private func watch() async {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(5))
      guard !Task.isCancelled else { continue }
      await act { try await session.api.waiting() }
    }
  }

  @discardableResult
  private func act(_ work: () async throws -> Waiting) async -> Bool {
    do {
      let n = try await work()
      withAnimation(reduceMotion ? .smooth(duration: 0.2) : .snappy) {
        loaded = .ready(n)
      }
      waiting = n.waiting
      return true
    } catch API.Failure.signedOut {
      session.close()
      return false
    } catch {
      if loaded.value == nil { loaded = .failed(error.localizedDescription) }
      return false
    }
  }
}

// One notice as a card: who it is from, when, what it says, the records it
// points at, and an ask's options or field.
private struct NoticeCard: View {
  let notice: Notice
  let titles: [String: String]
  let answer: (String) async -> Bool
  @ScaledMetric(relativeTo: .caption) private var dot = 7
  @State private var typed = ""
  @State private var sending = false
  @State private var landed: Bool?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        if notice.readAt == nil {
          Circle()
            .fill(.tint)
            .frame(width: dot, height: dot)
            .accessibilityLabel("Unread")
        }
        if notice.request != nil {
          Label("Ask to share", systemImage: "person.badge.plus")
            .font(.caption.weight(.medium))
            .foregroundStyle(.tint)
        }
        Text(notice.from)
          .font(.caption.weight(.medium))
          .foregroundStyle(.secondary)
        Spacer(minLength: 8)
        Text(notice.createdAt, format: .relative(presentation: .named))
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
      Text(notice.title).font(.headline)
      if !notice.body.isEmpty {
        Text(notice.body).font(.subheadline).foregroundStyle(.secondary)
      }
      if !notice.records.isEmpty { records }
      if notice.isAsk { ask }
    }
    .padding(16)
    .background(
      .fill.quaternary,
      in: ConcentricRectangle(corners: .concentric(minimum: .fixed(22)), isUniform: true))
    .sensoryFeedback(trigger: landed) { _, landed in landed == true ? .success : .error }
  }

  // The records a notice is about, each a chip that opens it.
  private var records: some View {
    FlowLayout(spacing: 8) {
      ForEach(notice.records, id: \.self) { id in
        NavigationLink(value: id) {
          Text(titles[id] ?? id).font(.subheadline).lineLimit(1)
        }
        .buttonStyle(.bordered)
      }
    }
  }

  @ViewBuilder private var ask: some View {
    if let said = notice.answer {
      Label(said, systemImage: "checkmark")
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.tint)
    } else if notice.options.isEmpty {
      HStack(spacing: 8) {
        TextField("Your answer", text: $typed)
          .textFieldStyle(.roundedBorder)
          .submitLabel(.send)
          .onSubmit { send(typed) }
        Button("Send", systemImage: "arrow.up") { send(typed) }
          .labelStyle(.iconOnly)
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty || sending)
      }
    } else {
      FlowLayout(spacing: 8) {
        ForEach(notice.options, id: \.self) { option in
          Button(option) { send(option) }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(sending)
        }
      }
    }
  }

  private func send(_ said: String) {
    let trimmed = said.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return }
    sending = true
    Task {
      landed = await answer(trimmed)
      sending = false
    }
  }
}
