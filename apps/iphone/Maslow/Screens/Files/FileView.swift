import QuickLook
import SwiftUI

// One file, as the phone opens it: text in an editor that saves back to
// the machine, and everything else in the phone's own preview — a picture,
// a video, a PDF as it is, an Office document as the machine renders it.
nonisolated enum FileContent: Sendable {
  case text(String, opened: String)
  case look(URL)
}

struct FileView: View {
  let open: FileOpen
  @Environment(Session.self) private var session
  @State private var loaded = Loaded<FileContent>.reading
  @State private var entry: FileEntry

  init(open: FileOpen) {
    self.open = open
    _entry = State(initialValue: open.entry)
  }

  var body: some View {
    Group {
      switch loaded {
      case .reading:
        ProgressView("Reading \(entry.name)…")
      case .failed(let said):
        Failed(said: said) { await look() }
      case .ready(.text(let text, let opened)):
        FileEditor(
          path: path, source: open.source, text: text, opened: opened,
          mayEdit: open.source.mayEdit, again: { await look() })
      case .ready(.look(let url)):
        FilePreview(url: url)
      }
    }
    .navigationTitle(entry.name)
    .toolbarTitleDisplayMode(.inline)
    .task { await look() }
  }

  // Where this file is: its path in the home, or its path under the thing
  // a colleague shared, which is empty for the shared file itself.
  private var path: String { open.entry.path }

  // The file as its folder or its share says it is, then its text where it
  // is text, and otherwise its bytes in a file of their own.
  private func look() async {
    loaded = .reading
    do {
      if case .shared = open.source {
        entry = try await session.api.fileStat(at: path, in: open.source)
      }
      let it = entry
      // Text by name, or a file of no known kind that turns out to be
      // text once read; anything bigger than the editor takes is looked at.
      let readable = (it.look == .text || it.look == .unknown) && it.size <= mostText
      if readable {
        let text = try await session.api.fileText(at: path, in: open.source)
        if it.look == .text || !text.contains("\0") {
          loaded = .ready(.text(text, opened: it.modified))
          return
        }
      }
      loaded = .ready(.look(try await download(it)))
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      loaded = .failed(error.localizedDescription)
    }
  }

  // The file into one of its own on this phone: an Office document as the
  // whole PDF the machine makes of it, everything else as it is.
  private func download(_ it: FileEntry) async throws -> URL {
    try await session.api.downloadFile(
      at: path, in: open.source, named: it.name, asPDF: it.look == .document)
  }
}

// The phone's own preview of one file, as Quick Look shows it: a picture,
// a video, a PDF, every page.
struct FilePreview: UIViewControllerRepresentable {
  let url: URL

  func makeCoordinator() -> Coordinator { Coordinator(url: url) }

  func makeUIViewController(context: UIViewControllerRepresentableContext<Self>)
    -> QLPreviewController
  {
    let controller = QLPreviewController()
    controller.dataSource = context.coordinator
    return controller
  }

  func updateUIViewController(
    _ controller: QLPreviewController, context: UIViewControllerRepresentableContext<Self>
  ) {
    context.coordinator.url = url
    controller.reloadData()
  }

  final class Coordinator: NSObject, QLPreviewControllerDataSource {
    var url: URL

    init(url: URL) {
      self.url = url
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int)
      -> any QLPreviewItem
    {
      url as NSURL
    }
  }
}

extension API {
  // One file of a shared thing as it now is: its name, kind, size and when
  // it last changed.
  func fileStat(at path: String, in source: FileSource) async throws -> FileEntry {
    var it: FileEntry = try JSONDecoder().decode(
      FileEntry.self, from: try await filesAsk(filesRequest(source.door("stat"), ["path": path])))
    it.path = path
    return it
  }
}
