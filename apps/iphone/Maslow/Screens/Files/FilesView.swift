import SwiftUI

// Files: the person's home on their own computer. Home and the usual
// places beside it, then what colleagues shared, each opening as a folder
// to walk or a file to look at.
struct FilesView: View {
  @Environment(Session.self) private var session
  @State private var top = Loaded<[FileEntry]>.reading
  @State private var shared: [Colleague] = []

  // The places the list offers beside Home, where they exist: the folders
  // a Mac's sidebar keeps, not everything at the top of the home.
  private static let places: Set<String> = [
    "Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music", "Projects", "Code",
    "code", "src", "work",
  ]

  var body: some View {
    List {
      Section {
        NavigationLink {
          FolderView(folder: FileFolder(path: "", name: "Home"))
        } label: {
          Label("Home", systemImage: "house.fill")
        }
        switch top {
        case .reading:
          Label("Reading your home…", systemImage: "folder")
            .foregroundStyle(.secondary)
        case .failed(let said):
          Text(said).foregroundStyle(.red)
        case .ready(let entries):
          ForEach(entries.filter { $0.isFolder && Self.places.contains($0.name) }) { place in
            NavigationLink {
              FolderView(folder: FileFolder(path: place.name, name: place.name))
            } label: {
              Label(place.name, systemImage: "folder.fill")
            }
          }
        }
      }
      ForEach(shared) { colleague in
        Section(colleague.owner) {
          ForEach(colleague.files) { thing in
            SharedRow(thing: thing)
          }
        }
      }
    }
    .navigationTitle("Files")
    .navigationDestination(for: FileFolder.self) { FolderView(folder: $0) }
    .navigationDestination(for: FileOpen.self) { FileView(open: $0) }
    .refreshable { await load() }
    .task { await load() }
  }

  private func load() async {
    do {
      top = .ready(try await session.api.folder(at: "", in: .home))
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      if top.value == nil { top = .failed(error.localizedDescription) }
    }
    // A share that landed is one of theirs beside their own; the list
    // stays as it was when this cannot be read.
    shared = (try? await session.api.sharedFiles()) ?? shared
  }
}

// One thing a colleague shared: their folder to walk, or their file to
// look at, through the share it came by.
private struct SharedRow: View {
  let thing: SharedThing

  var body: some View {
    let source = FileSource.shared(id: thing.id, level: thing.level)
    if thing.kind == "dir" {
      NavigationLink {
        FolderView(folder: FileFolder(source: source, path: "", name: thing.name))
      } label: {
        Label(thing.name, systemImage: "folder.fill.badge.person.crop")
      }
    } else {
      NavigationLink {
        FileView(
          open: FileOpen(
            source: source,
            entry: FileEntry(
              name: thing.name, kind: "file", size: 0, modified: "", sharedId: thing.id, path: "")))
      } label: {
        Label(thing.name, systemImage: "doc.fill")
      }
    }
  }
}

// One folder, wherever it is read from.
nonisolated struct FileFolder: Hashable, Sendable {
  var source = FileSource.home
  var path: String
  var name: String
}

// One file, as the screen opens it.
nonisolated struct FileOpen: Hashable, Sendable {
  var source = FileSource.home
  var entry: FileEntry
}

// A time a door wrote, as a row says it: the clock for today, the day
// otherwise, and as it came when this phone cannot read it.
func fileWhen(_ iso: String) -> String {
  let parsed =
    (try? Date(
      iso, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
    ?? (try? Date(iso, strategy: .iso8601))
  guard let parsed else { return iso }
  return Calendar.current.isDateInToday(parsed)
    ? parsed.formatted(date: .omitted, time: .shortened)
    : parsed.formatted(.dateTime.day().month(.abbreviated))
}
