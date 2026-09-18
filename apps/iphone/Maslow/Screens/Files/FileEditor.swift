import SwiftUI

// A text file, edited here and saved back to the machine. A save names
// when the file was last changed as it was opened; one that fell behind is
// not written over but asked about, save anyway or take theirs. A file the
// person may only look at is read and not typed in.
struct FileEditor: View {
  let path: String
  let source: FileSource
  let mayEdit: Bool
  let again: () async -> Void
  @Environment(Session.self) private var session
  @State private var text: String
  @State private var opened: String
  @State private var dirty = false
  @State private var saving = false
  @State private var refused: String?
  @State private var behind: String?
  @State private var saves = 0
  @State private var refusals = 0

  init(
    path: String, source: FileSource, text: String, opened: String, mayEdit: Bool,
    again: @escaping () async -> Void
  ) {
    self.path = path
    self.source = source
    self.mayEdit = mayEdit
    self.again = again
    _text = State(initialValue: text)
    _opened = State(initialValue: opened)
  }

  var body: some View {
    TextEditor(text: $text)
      .font(.body.monospaced())
      .textEditorStyle(.plain)
      .autocorrectionDisabled()
      .textInputAutocapitalization(.never)
      .disabled(!mayEdit)
      .onChange(of: text) { dirty = true }
      .safeAreaInset(edge: .bottom) {
        if let refused {
          Text(refused)
            .font(.footnote)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
        }
      }
      .toolbar {
        if mayEdit {
          ToolbarItem {
            Button("Save") { Task { await save() } }
              .disabled(!dirty || saving)
          }
        }
      }
      .confirmationDialog(
        behind.map { "This changed on your computer at \(fileWhen($0))." } ?? "",
        isPresented: .init(get: { behind != nil }, set: { if !$0 { behind = nil } }),
        titleVisibility: .visible
      ) {
        Button("Save over it") { Task { await save(anyway: true) } }
        Button("Take theirs") {
          behind = nil
          Task { await again() }
        }
        Button("Keep typing", role: .cancel) { behind = nil }
      }
      .sensoryFeedback(.success, trigger: saves)
      .sensoryFeedback(.error, trigger: refusals)
      .navigationSubtitle(dirty ? "Not saved" : "Saved")
  }

  private func save(anyway: Bool = false) async {
    saving = true
    refused = nil
    behind = nil
    defer { saving = false }
    do {
      let written = try await session.api.writeFile(
        at: path, in: source, text: text, opened: anyway ? nil : opened)
      opened = written.modified
      dirty = false
      saves += 1
    } catch let fell as FileBehind {
      behind = fell.modified
      refusals += 1
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      refused = error.localizedDescription
      refusals += 1
    }
  }
}
