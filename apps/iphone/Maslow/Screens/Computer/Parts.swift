import SwiftUI

// The parts of the Computer pane, one under another, each a section of the
// same list: the update waiting, what it is, what it is using, where it is,
// the backups kept, and reset.

// The update waiting on the person: one button, which names what it stops
// before it stops it.
struct ComputerUpdateWaiting: View {
  let machine: Machine
  @Environment(Session.self) private var session
  @State private var asking = false

  var body: some View {
    if let update = machine.update {
      Section {
        LabeledContent("An update is ready", value: update.image)
        Button("Update") { asking = true }
          .frame(minHeight: 44)
          .disabled(machine.busy)
          .confirmationDialog(
            "Update your computer?", isPresented: $asking, titleVisibility: .visible
          ) {
            Button("Update") { take() }
            Button("Not now", role: .cancel) {}
          } message: {
            Text(stops)
          }
      } header: {
        Text("Update")
      } footer: {
        Text("Ready since \(computerMoment(update.readyAt)).")
      }
    }
  }

  // What the restart stops, named before it stops it.
  private var stops: String {
    guard let stats = machine.stats else {
      return
        "Your computer did not say what is running on it. Updating stops whatever is; your files are untouched, and it is back in about a minute."
    }
    let running = stats.stops
    return running.isEmpty
      ? "Nothing is running on your computer. Your files are untouched, and it is back in about a minute."
      : "This stops \(running.formatted(.list(type: .and))). Your files are untouched, and your computer is back in about a minute."
  }

  private func take() {
    let api = session.api
    machine.restarting()
    Task {
      await machine.doing(api) { api in
        try await api.takeUpdate()
        return "Your computer is restarting onto the new image."
      }
    }
  }
}

// What the computer is using this moment, and what it is.
struct ComputerNumbers: View {
  let machine: Machine

  var body: some View {
    Section("What it is using") {
      if let stats = machine.stats {
        gauge("CPU", share: stats.cpu / 100, said: "\(Int(stats.cpu.rounded()))%")
        gauge(
          "Memory", share: stats.memoryShare,
          said: "\(computerBytes(stats.memory.used)) of \(computerBytes(stats.memory.total))")
        LabeledContent("Disk", value: stats.used.map(computerBytes) ?? "measuring what is used…")
      } else {
        LabeledContent("Reading the numbers") { ProgressView() }
      }
    }
    if let about = machine.about {
      Section("What it is") {
        if let size = about.size { LabeledContent("Size", value: size) }
        if let disk = about.diskGb { LabeledContent("Disk", value: "\(disk) GB") }
        LabeledContent("Image", value: about.image)
        if let machineId = about.machine {
          LabeledContent("Machine", value: machineId).monospaced()
        }
      }
    }
  }

  private func gauge(_ name: String, share: Double, said: String) -> some View {
    Gauge(value: min(max(share, 0), 1)) {
      Text(name)
    } currentValueLabel: {
      Text(said).monospacedDigit()
    }
    .gaugeStyle(.accessoryLinearCapacity)
  }
}

// Where the computer is, with the round trip this phone measures to its
// own door, and a move, which nothing but the person starts.
struct ComputerWhereabouts: View {
  let machine: Machine
  @Environment(Session.self) private var session
  @State private var asked: String?

  var body: some View {
    Section {
      LabeledContent("Your computer", value: ComputerRegions.region(machine.state?.region ?? ""))
      LabeledContent("Round trip") {
        if let trip = machine.trip {
          Text("\(trip) ms").monospacedDigit()
        } else if machine.tripFailed != nil {
          Text("not measured")
        } else {
          ProgressView()
        }
      }
      Menu("Move to another region") {
        ForEach(ComputerRegions.codes, id: \.self) { code in
          Button(ComputerRegions.region(code)) { asked = code }
            .disabled(code == machine.state?.region)
        }
      }
      .frame(minHeight: 44)
      .disabled(machine.busy)
      .confirmationDialog(
        asked.map { "Move to \(ComputerRegions.region($0))?" } ?? "Move?",
        isPresented: Binding(get: { asked != nil }, set: { if !$0 { asked = nil } }),
        titleVisibility: .visible
      ) {
        Button("Move") { move() }
        Button("Keep", role: .cancel) {}
      } message: {
        Text(
          "This takes a few minutes: your computer stops, its disk is copied there, and it starts there. Your files, your packages and your whole Linux come with it; anything running stops. If anything goes wrong on the way it comes back on where it is now."
        )
      }
    } header: {
      Text("Where")
    } footer: {
      Text(far ?? "Nothing moves your computer but you.")
        .foregroundStyle(far == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
    }
  }

  // A round trip a terminal would feel, said when it is not one.
  private var far: String? {
    guard let trip = machine.trip else { return machine.tripFailed }
    guard trip > ComputerRegions.budgetMs else { return nil }
    return "A round trip of \(trip) ms; under \(ComputerRegions.budgetMs) feels like a terminal."
  }

  private func move() {
    guard let to = asked else { return }
    asked = nil
    let api = session.api
    Task {
      await machine.doing(api) { api in
        try await api.moveComputer(to: to)
        return "Moving your computer to \(ComputerRegions.region(to))."
      }
    }
  }
}

// The backups kept of the home, newest first, each one a folder away.
struct ComputerBacked: View {
  let machine: Machine
  @Environment(Session.self) private var session

  var body: some View {
    Section {
      if let coming = machine.backups?.restoring {
        Text(said(coming))
          .font(.footnote)
          .foregroundStyle(coming.error == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
      }
      if let kept = machine.backups?.kept {
        if kept.isEmpty {
          Text("No backups yet; the first one comes within the hour.")
            .foregroundStyle(.secondary)
        }
        ForEach(kept) { backup in
          LabeledContent {
            Button("Restore") { restore(backup.key) }
              .buttonStyle(.bordered)
              .disabled(machine.busy || coming)
          } label: {
            Text(computerMoment(backup.at))
            Text(computerBytes(backup.bytes))
          }
          .frame(minHeight: 44)
        }
      } else {
        LabeledContent("Reading your backups") { ProgressView() }
      }
    } header: {
      Text("Backups")
    } footer: {
      Text(
        "A new backup every day, the last fourteen kept. A restore lands in a dated folder of its own in your home and writes over nothing."
      )
    }
  }

  private var coming: Bool {
    machine.backups?.restoring.map { !$0.landed } ?? false
  }

  private func said(_ coming: RestoringBackup) -> String {
    if let error = coming.error { return "The backup did not come back: \(error)" }
    if coming.finishedAt != nil { return "Restored into ~/\(coming.name)." }
    return coming.step == "fetching"
      ? "Fetching a backup into ~/\(coming.name)…"
      : "Unpacking \(computerBytes(coming.bytes)) into ~/\(coming.name)…"
  }

  private func restore(_ key: String) {
    let api = session.api
    Task {
      await machine.doing(api) { api in
        let name = try await api.restoreBackup(key)
        await machine.kept(api)
        return "Coming back into ~/\(name)."
      }
    }
  }
}

// The Linux thrown away and made again, which takes the computer's name
// typed exactly.
struct ComputerReset: View {
  let machine: Machine
  @Environment(Session.self) private var session
  @State private var asking = false
  @State private var typed = ""

  var body: some View {
    Section {
      Button("Start your Linux over", role: .destructive) {
        typed = ""
        asking = true
      }
      .frame(minHeight: 44)
      .disabled(machine.busy)
      .sheet(isPresented: $asking) { sheet }
    } footer: {
      Text("Throws away everything outside your home and keeps your home.")
    }
  }

  private var name: String { session.org?.name ?? "" }

  private var sheet: some View {
    NavigationStack {
      Form {
        Section {
          Text(
            "Everything you installed with apt or changed outside your home is thrown away and replaced with a fresh Linux. Your home, with your files, packages and settings, is kept. Anything running stops. This takes about a minute, and any backup can be restored into a folder of your home afterwards."
          )
        }
        Section("Type \(name) to go on") {
          TextField("Your computer's name", text: $typed)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .frame(minHeight: 44)
        }
        Section {
          Button("Reset", role: .destructive) { reset() }
            .frame(minHeight: 44)
            .disabled(typed != name || name.isEmpty)
        }
      }
      .navigationTitle("Start your Linux over?")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Keep", systemImage: "xmark") { asking = false }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func reset() {
    asking = false
    let api = session.api
    machine.restarting()
    Task {
      await machine.doing(api) { api in
        try await api.resetComputer()
        return "Your Linux is being made again; your home is kept."
      }
    }
  }
}
