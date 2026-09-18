import SwiftUI

// The computer: where it stands, the four ways into it, and what the
// Computer pane of Settings holds — the update waiting, what it is and is
// using, where it is, its backups and reset. Nothing but the standing
// shows until its door answers.
struct ComputerView: View {
  @Environment(Session.self) private var session
  @Environment(\.scenePhase) private var phase
  @State private var machine = Machine()

  var body: some View {
    NavigationStack {
      List {
        Section { Standing(machine: machine) }
        if machine.ready {
          Section("Ways in") { Ways() }
          ComputerUpdateWaiting(machine: machine)
          ComputerNumbers(machine: machine)
          ComputerWhereabouts(machine: machine)
          ComputerBacked(machine: machine)
          ComputerReset(machine: machine)
        }
      }
      .navigationTitle("Computer")
      .refreshable { await machine.look(session.api) }
      .sensoryFeedback(.success, trigger: machine.said) { _, said in said != nil }
      .sensoryFeedback(.error, trigger: machine.failed) { _, failed in failed != nil }
    }
    // The pane asks while it is on screen and stops the moment the phone
    // is put down.
    .task(id: phase) {
      guard phase == .active else { return }
      await machine.watch(session.api)
    }
  }
}

// Plain first: ready and where, or the making with the step it is on and
// the region named, or a move with its own steps.
private struct Standing: View {
  let machine: Machine
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let state = machine.state {
        if state.ready {
          Label {
            Text("Ready in \(ComputerRegions.region(state.region ?? ""))")
          } icon: {
            Image(systemName: "circle.fill").foregroundStyle(.green)
          }
          .font(.body)
        } else if let move = state.move {
          let step = ComputerSteps.moving[move.step] ?? (0, "Moving it")
          ProgressView(value: step.0) {
            Text("Moving your computer to \(ComputerRegions.region(move.to))")
          }
          Text(
            "\(step.1.replacingOccurrences(of: "_", with: ComputerRegions.region(move.to))). This takes a few minutes; your files come with it, and nothing on the computer can be opened until it is there."
          )
          .font(.footnote).foregroundStyle(.secondary)
        } else if state.off {
          Text("Computers are off here: this deployment has no Fly token.")
            .foregroundStyle(.secondary)
        } else {
          let step = ComputerSteps.making[state.progress] ?? (0, "Getting it ready")
          ProgressView(value: step.0) { Text(step.1) }
          Text(
            "\(step.1)\(state.region.map { " in \(ComputerRegions.region($0))" } ?? ""). This takes a minute the first time."
          )
          .font(.footnote).foregroundStyle(.secondary)
        }
        if let failed = state.failed { ComputerSaid(failed, bad: true) }
      } else if machine.failed == nil {
        HStack { ProgressView(); Text("Asking your computer…").foregroundStyle(.secondary) }
      }
      if let failed = machine.failed { ComputerSaid("\(failed) Trying again.", bad: true) }
      if let said = machine.said { ComputerSaid(said, bad: false) }
    }
    .animation(reduceMotion ? .smooth(duration: 0.2) : .snappy, value: machine.state)
  }
}

// The four surfaces of the machine, each a page away.
private struct Ways: View {
  var body: some View {
    Group {
      NavigationLink { TerminalView() } label: {
        Label("Terminal", systemImage: "apple.terminal")
      }
      NavigationLink { BrowserView() } label: {
        Label("Browser", systemImage: "safari")
      }
      NavigationLink { FilesView() } label: {
        Label("Files", systemImage: "folder")
      }
      NavigationLink { PortsView() } label: {
        Label("Ports", systemImage: "app.connected.to.app.below.fill")
      }
    }
    .frame(minHeight: 44)
  }
}

// A sentence from a door, good or bad, as the pane says it.
struct ComputerSaid: View {
  let words: String
  let bad: Bool

  init(_ words: String, bad: Bool) {
    self.words = words
    self.bad = bad
  }

  var body: some View {
    Text(words)
      .font(.footnote)
      .foregroundStyle(bad ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
  }
}

// A time the server wrote, as this phone says it; one it cannot read stays
// as it came.
func computerMoment(_ iso: String) -> String {
  let parsed =
    (try? Date(
      iso, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
    ?? (try? Date(iso, strategy: .iso8601))
  guard let parsed else { return iso }
  return parsed.formatted(date: .abbreviated, time: .shortened)
}

// A size in words, to one decimal, as a person says it.
func computerBytes(_ count: Double?) -> String {
  guard let count else { return "size unknown" }
  return count >= Double(1 << 30)
    ? "\((count / Double(1 << 30)).formatted(.number.precision(.fractionLength(1)))) GB"
    : "\((count / Double(1 << 20)).rounded().formatted()) MB"
}
