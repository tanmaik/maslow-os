import PhotosUI
import SwiftUI

// What is on its way from this phone to the machine, as the list shows it.
@Observable final class Uploading {
  nonisolated struct Going: Identifiable, Sendable {
    var id: String
    var name: String
    var done: Int
    var total: Int
    var failed: String?
  }
  var going: [Going] = []

  func start(_ id: String, name: String, total: Int) {
    going.removeAll { $0.id == id }
    going.append(Going(id: id, name: name, done: 0, total: total))
  }

  func mark(_ id: String, done: Int) {
    if let i = going.firstIndex(where: { $0.id == id }) { going[i].done = done }
  }

  func failed(_ id: String, name: String, _ said: String) {
    if let i = going.firstIndex(where: { $0.id == id }) {
      going[i].failed = said
    } else {
      going.append(Going(id: id, name: name, done: 0, total: 1, failed: said))
    }
  }

  func landed(_ id: String) {
    going.removeAll { $0.id == id }
  }
}

// One folder: folders first, then files, each a tap from what it is. A
// file is put here from the phone's photos or its own files, straight to
// the machine's door. The list follows the disk — the folder is watched
// through the door, and read again every five seconds while nothing is
// watching it.
struct FolderView: View {
  let folder: FileFolder
  @Environment(Session.self) private var session
  @State private var loaded = Loaded<[FileEntry]>.reading
  @State private var uploading = Uploading()
  @State private var query = ""
  @State private var watching = false
  @State private var picking = false
  @State private var importing = false
  @State private var photos: [PhotosPickerItem] = []
  @State private var sharing: FileEntry?
  @State private var landed = 0
  @State private var refusals = 0

  var body: some View {
    List {
      if !uploading.going.isEmpty {
        Section("Going up") {
          ForEach(uploading.going) { going in
            VStack(alignment: .leading, spacing: 4) {
              if let failed = going.failed {
                Text(going.name)
                Text(failed).font(.footnote).foregroundStyle(.red)
              } else {
                ProgressView(value: Double(going.done), total: Double(max(going.total, 1))) {
                  Text(going.name)
                }
              }
            }
          }
        }
      }
      switch loaded {
      case .reading:
        Label("Reading this folder…", systemImage: "folder").foregroundStyle(.secondary)
      case .failed(let said):
        Section { Text(said).foregroundStyle(.red) }
      case .ready(let entries):
        let shown = narrowed(entries)
        if shown.isEmpty {
          Section {
            ContentUnavailableView(
              query.isEmpty ? "Nothing here" : "No name carries that",
              systemImage: query.isEmpty ? "folder" : "magnifyingglass")
          }
        } else {
          ForEach(shown) { entry in Row(entry: entry, folder: folder, sharing: $sharing) }
        }
      }
    }
    .navigationTitle(folder.name)
    .searchable(text: $query, prompt: "Name")
    .refreshable { await load() }
    .toolbar {
      if folder.source.mayEdit {
        ToolbarItem {
          Menu("Add a file", systemImage: "plus") {
            Button("Photos", systemImage: "photo.on.rectangle") { picking = true }
            Button("Files", systemImage: "folder") { importing = true }
          }
        }
      }
    }
    .photosPicker(isPresented: $picking, selection: $photos, matching: .any(of: [.images, .videos]))
    .fileImporter(
      isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true
    ) { picked in
      switch picked {
      case .success(let urls): for url in urls { take(url) }
      case .failure(let why):
        uploading.failed(UUID().uuidString, name: "That file", why.localizedDescription)
        refusals += 1
      }
    }
    .sheet(item: $sharing) { entry in
      FileShareSheet(entry: entry) { await load() }
    }
    .sensoryFeedback(.success, trigger: landed)
    .sensoryFeedback(.error, trigger: refusals)
    .task(id: photos.count) { await takePhotos() }
    .task { await load() }
    // The door says what changed in this folder; the list is read again
    // the moment it does.
    .task { await watch() }
    // While nothing is watching — no ticket, no socket — the folder is
    // read again every five seconds.
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(5))
        if !watching { await load() }
      }
    }
  }

  // Folders first, then by name, narrowed to the word typed and to what
  // is not hidden: a name beginning with a dot is the machine's own
  // business until it is asked for by name.
  private func narrowed(_ entries: [FileEntry]) -> [FileEntry] {
    let word = query.trimmingCharacters(in: .whitespaces).lowercased()
    return entries
      .filter { !$0.name.hasPrefix(".") || !word.isEmpty }
      .filter { word.isEmpty || $0.name.lowercased().contains(word) }
      .sorted {
        $0.isFolder == $1.isFolder
          ? $0.name.localizedStandardCompare($1.name) == .orderedAscending
          : $0.isFolder
      }
  }

  private func load() async {
    do {
      loaded = .ready(try await session.api.folder(at: folder.path, in: folder.source))
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      if loaded.value == nil {
        loaded = .failed(error.localizedDescription)
      } else {
        refusals += 1
      }
    }
  }

  // Watches this folder through the machine's own door, reading the list
  // again when it says something changed. A socket that closes is dialled
  // again a second later, a refused ticket five, and a live one is dropped
  // before its hour is up so the next carries a fresh ticket.
  private func watch() async {
    guard case .home = folder.source else { return }
    while !Task.isCancelled {
      do {
        let live = try await session.api.live()
        let socket = try await DoorSocket(live, path: "/maslow/view")
        watching = true
        try await socket.send(json: ["watch": folder.path.isEmpty ? "." : folder.path])
        let hour = Task {
          try? await Task.sleep(for: .seconds(3000))
          socket.close()
        }
        for await frame in socket.frames {
          guard case .text(let said) = frame, changed(said) else { continue }
          await load()
        }
        hour.cancel()
        socket.close()
        watching = false
        try? await Task.sleep(for: .seconds(1))
      } catch {
        watching = false
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  // Whether one of the door's words says something in the folder changed.
  private func changed(_ said: String) -> Bool {
    let word = try? JSONSerialization.jsonObject(with: Data(said.utf8)) as? [String: Any]
    return (word ?? nil)?["changed"] != nil
  }

  // Whatever was picked in Photos, sent under a name of its own kind.
  private func takePhotos() async {
    let picked = photos
    guard !picked.isEmpty else { return }
    photos = []
    let stamp = Date.now.formatted(
      .dateTime.year().month(.twoDigits).day().hour().minute().second())
    for (n, item) in picked.enumerated() {
      let ending = item.supportedContentTypes.first?.preferredFilenameExtension ?? "dat"
      let name = "\(stamp) \(n + 1).\(ending)".replacingOccurrences(of: "/", with: "-")
      do {
        guard let bytes = try await item.loadTransferable(type: Data.self) else {
          uploading.failed(name, name: name, "That photo could not be read from this phone.")
          refusals += 1
          continue
        }
        await send(bytes: bytes, named: name)
      } catch {
        uploading.failed(name, name: name, error.localizedDescription)
        refusals += 1
      }
    }
  }

  // A file the phone's own Files app handed over, read while it is open to
  // us and then sent.
  private func take(_ url: URL) {
    let reached = url.startAccessingSecurityScopedResource()
    defer { if reached { url.stopAccessingSecurityScopedResource() } }
    let name = url.lastPathComponent
    do {
      let bytes = try Data(contentsOf: url)
      Task { await send(bytes: bytes, named: name) }
    } catch {
      uploading.failed(name, name: name, error.localizedDescription)
      refusals += 1
    }
  }

  // One file to the machine's door, in pieces, with how far it has got on
  // screen as it goes.
  private func send(bytes: Data, named name: String) async {
    let at = folder.path.isEmpty ? name : "\(folder.path)/\(name)"
    uploading.start(at, name: name, total: bytes.count)
    let marking = uploading
    do {
      let target = try await session.api.fileUploadTarget(in: folder.source)
      try await sendToDoor(
        target, path: at, bytes: bytes, modified: Int(Date.now.timeIntervalSince1970 * 1000)
      ) { done in
        Task { @MainActor in marking.mark(at, done: done) }
      }
      uploading.landed(at)
      landed += 1
      await load()
    } catch {
      uploading.failed(at, name: name, error.localizedDescription)
      refusals += 1
    }
  }
}

// One thing in the folder: a folder to go into, a file to look at, and
// the way to share one of the person's own.
private struct Row: View {
  let entry: FileEntry
  let folder: FileFolder
  @Binding var sharing: FileEntry?

  var body: some View {
    Group {
      if entry.isFolder {
        NavigationLink(value: FileFolder(source: folder.source, path: entry.path, name: entry.name))
        {
          label
        }
      } else {
        NavigationLink(value: FileOpen(source: folder.source, entry: entry)) { label }
      }
    }
    .frame(minHeight: 44)
    .contextMenu {
      if case .home = folder.source {
        Button("Share…", systemImage: "person.2") { sharing = entry }
      }
    }
  }

  private var label: some View {
    Label {
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.name)
        Text(detail).font(.footnote).foregroundStyle(.secondary)
      }
    } icon: {
      Image(systemName: entry.mark)
    }
  }

  // What the row says under the name: when it changed, how big it is where
  // it is a file, and that it is shared where it is.
  private var detail: String {
    var said = [entry.modified.isEmpty ? "" : fileWhen(entry.modified)]
    if !entry.isFolder { said.append(entry.weight) }
    if entry.sharedId != nil { said.append("Shared") }
    return said.filter { !$0.isEmpty }.joined(separator: " · ")
  }
}
