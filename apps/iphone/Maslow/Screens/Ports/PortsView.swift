import SwiftUI

// Ports: what the person's computer is serving, who reaches each of them,
// the ports colleagues opened to them, and the widgets standing on their
// desktop. Read again every few seconds, so a server started a moment ago
// is here without a pull.
struct PortsView: View {
  @Environment(Session.self) private var session
  @State private var loaded = Loaded<PortsFound>.reading
  @State private var sharing: PortSharing?
  @State private var machine: String?
  @State private var said: String?
  @State private var refusals = 0
  @State private var picked: Listening?

  var body: some View {
    Group {
      switch loaded {
      case .reading:
        ProgressView()
      case .failed(let why):
        Failed(said: why) { await read() }
      case .ready(let ports):
        if ports.isEmpty {
          ContentUnavailableView(
            "No ports", systemImage: "app.dashed",
            description: Text("Anything your computer serves is here, and so is any port a colleague opens to you."))
        } else {
          list(ports)
        }
      }
    }
    .navigationTitle("Ports")
    .navigationSubtitle(loaded.value?.subtitle ?? "")
    .toolbarTitleDisplayMode(.inline)
    .sensoryFeedback(.error, trigger: refusals)
    .sheet(item: $picked) { port in
      PortShareSheet(port: port.port, sharing: sharing) { reach in
        await save(port: port.port, to: reach)
      }
    }
    .task {
      // While this page is on screen it asks again, so what changed
      // elsewhere — a port opened, a share ended, a widget placed — is here
      // within seconds.
      while !Task.isCancelled {
        await read()
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  private func list(_ ports: PortsFound) -> some View {
    List {
      if !ports.mine.isEmpty {
        Section {
          ForEach(ports.mine) { port in
            NavigationLink {
              PortPage(title: "Port \(port.port)", href: link(port.port))
            } label: {
              Own(port: port, reach: sharing?.reach(of: port.port))
            }
            .swipeActions(edge: .trailing) {
              Button("Share", systemImage: "person.badge.plus") { picked = port }
            }
            .contextMenu {
              Button("Share…", systemImage: "person.badge.plus") { picked = port }
              if let address = address(port.port) {
                ShareLink(item: address)
              }
            }
          }
        } header: {
          Text("On your computer")
        } footer: {
          if let said { Text(said) }
        }
      }
      if !ports.theirs.isEmpty {
        Section("Opened to you") {
          ForEach(ports.theirs) { port in
            NavigationLink(port.title) { PortPage(title: port.title, href: port.href) }
          }
        }
      }
      if !ports.widgets.isEmpty {
        Section("On your desktop") {
          ForEach(ports.widgets) { widget in
            NavigationLink {
              PortPage(title: widget.title, href: widget.href)
            } label: {
              Label(widget.title, systemImage: "square.dashed")
            }
          }
        }
      }
      if ports.mine.isEmpty, let said {
        Section { Text(said) }
      }
    }
    .refreshable { await read() }
  }

  // Our own address for one of the person's ports, which mints the ticket
  // and points at the machine.
  private func link(_ port: Int) -> String {
    "/port/\(machine ?? sharing?.machineId ?? "")/\(port)"
  }

  private func address(_ port: Int) -> URL? {
    URL(string: link(port), relativeTo: session.api.server)?.absoluteURL
  }

  private func read() async {
    do {
      if machine == nil { machine = try await session.api.machine() }
      // A silent door leaves the ports of the person's own computer unsaid;
      // what colleagues opened, and the desktop, are still said.
      async let mine = session.api.listening()
      async let theirs = session.api.openablePorts()
      async let widgets = session.api.widgets()
      let ours = machine
      let ports = PortsFound(
        mine: (try? await mine) ?? [],
        theirs: try await theirs.filter { link in
          guard let ours else { return true }
          return !link.href.contains("/\(ours)/")
        },
        widgets: try await widgets)
      loaded = .ready(ports)
      said = nil
      // Whom a port may be given to is read beside it; a deployment whose
      // door does not answer it still opens and shares with everyone.
      sharing = try? await session.api.sharing()
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      if loaded.value == nil {
        loaded = .failed(error.localizedDescription)
      } else {
        said = error.localizedDescription
        refusals += 1
      }
    }
  }

  private func save(port: Int, to reach: PortReach) async -> String? {
    do {
      try await session.api.share(port: port, to: reach)
      await read()
      return nil
    } catch API.Failure.signedOut {
      session.close()
      return nil
    } catch {
      return error.localizedDescription
    }
  }
}

// What this page holds: the person's own listening ports, the ports opened
// to them, and the widgets on their desktop.
nonisolated struct PortsFound: Sendable {
  var mine: [Listening]
  var theirs: [PortLink]
  var widgets: [PortLink]

  var isEmpty: Bool { mine.isEmpty && theirs.isEmpty && widgets.isEmpty }

  var subtitle: String {
    let n = mine.count
    return n == 0 ? "" : n == 1 ? "1 listening" : "\(n) listening"
  }
}

// One of the person's own ports: that it is up, its number, what runs
// there, and who reaches it.
private struct Own: View {
  let port: Listening
  let reach: PortReach?
  @ScaledMetric(relativeTo: .caption) private var dot = 8

  var body: some View {
    LabeledContent {
      if let said = reach?.said {
        Text(said).font(.subheadline)
      }
    } label: {
      HStack(spacing: 10) {
        Circle()
          .fill(.green)
          .frame(width: dot, height: dot)
          .accessibilityLabel("Listening")
        VStack(alignment: .leading, spacing: 2) {
          Text("\(port.port)")
            .font(.body.weight(.medium))
            .monospacedDigit()
          if !port.said.isEmpty {
            Text(port.said).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
    }
  }
}
