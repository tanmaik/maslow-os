import Foundation

// The person's files on their own computer, and what colleagues shared
// with them, as the site's file doors answer. Every refusal carries the
// sentence the door wrote, so it can be shown as it is.

// Where a folder and its files are read: the person's own home, or one
// thing a colleague shared, by the id it is shared under.
nonisolated enum FileSource: Hashable, Sendable {
  case home
  case shared(id: String, level: String)

  // Whether the person may write here: their own home, or a share at
  // edit or owner.
  var mayEdit: Bool {
    switch self {
    case .home: true
    case .shared(_, let level): level != "view"
    }
  }

  // Where one ask about a path in this source goes.
  func door(_ what: String) -> String {
    switch self {
    case .home: "/computer/files/\(what)"
    case .shared(let id, _): "/file/\(id)/\(what)"
    }
  }
}

// One thing in a folder, as a door lists it, with the id it is shared by
// where it is and the path it was found at.
nonisolated struct FileEntry: Decodable, Hashable, Identifiable, Sendable {
  var name: String
  var kind: String
  var size: Int
  var modified: String
  var sharedId: String?
  var path: String = ""

  enum CodingKeys: String, CodingKey {
    case name, kind, size, modified
    case sharedId = "id"
  }

  var id: String { path.isEmpty ? name : path }
  var isFolder: Bool { kind == "dir" }
}

// The most text the editor takes in. Past this a file is looked at rather
// than read, so a huge log never holds the screen.
nonisolated let mostText = 2 * 1024 * 1024

// What a thing in a folder is, by its name: what the screen does with it.
nonisolated enum FileLook: Equatable, Sendable {
  case folder, text, image, video, audio, pdf, document, unknown
}

extension FileEntry {
  private static let text: Set<String> = [
    "txt", "md", "json", "js", "mjs", "ts", "tsx", "css", "html", "sh", "py", "yml", "yaml",
    "toml", "env", "gitignore", "csv", "log", "xml", "sql",
  ]
  private static let image: Set<String> = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic", "tif", "tiff", "bmp",
  ]
  private static let video: Set<String> = ["mp4", "m4v", "mov", "webm", "mkv"]
  private static let audio: Set<String> = ["mp3", "m4a", "wav", "ogg", "flac", "aac", "opus"]
  private static let document: Set<String> = [
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
  ]

  var ending: String {
    name.contains(".") ? (name.split(separator: ".").last?.lowercased() ?? "") : ""
  }

  var look: FileLook {
    if isFolder { return .folder }
    if Self.text.contains(ending) { return .text }
    if Self.image.contains(ending) { return .image }
    if Self.video.contains(ending) { return .video }
    if Self.audio.contains(ending) { return .audio }
    if ending == "pdf" { return .pdf }
    if Self.document.contains(ending) { return .document }
    return .unknown
  }

  // The mark it wears in the list.
  var mark: String {
    switch look {
    case .folder: kind == "dir" ? "folder.fill" : "link"
    case .text: "doc.text.fill"
    case .image: "photo.fill"
    case .video: "film.fill"
    case .audio: "waveform"
    case .pdf: "doc.richtext.fill"
    case .document: "doc.fill"
    case .unknown: kind == "link" ? "link" : "doc.fill"
    }
  }

  // Bytes in words a person reads at a glance.
  var weight: String {
    let n = Double(size)
    if size < 1024 { return "\(size) B" }
    if size < 1024 * 1024 { return "\(Int(n / 1024)) KB" }
    if size < 1024 * 1024 * 1024 { return String(format: "%.1f MB", n / (1024 * 1024)) }
    return String(format: "%.2f GB", n / (1024 * 1024 * 1024))
  }
}

// One thing a colleague shared, as Files opens it.
nonisolated struct SharedThing: Decodable, Hashable, Identifiable, Sendable {
  var id: String
  var name: String
  var kind: String
  var level: String
}

// What one colleague shared with the person.
nonisolated struct Colleague: Decodable, Identifiable, Sendable {
  var owner: String
  var ownerId: String
  var files: [SharedThing]
  var id: String { ownerId }
}

// Who a shared thing can be given to, and everything of the person's that
// is shared with who each reaches.
nonisolated struct Sharing: Decodable, Sendable {
  nonisolated struct Party: Decodable, Hashable, Identifiable, Sendable {
    var id: String
    var name: String
  }
  nonisolated struct Marked: Decodable, Sendable {
    var id: String
    var name: String
    var kind: String
  }
  nonisolated struct Given: Decodable, Sendable {
    var fileId: String
    var subject: String
    var memberId: String?
    var groupId: String?
    var level: String
  }
  var members: [Party]
  var groups: [Party]
  var files: [Marked]
  var shares: [Given]

  // What one thing of the person's reaches now, by the id it is shared
  // under; nothing where it is not shared.
  func reach(of id: String?) -> Reach {
    let on = id.map { was in shares.filter { $0.fileId == was } } ?? []
    return Reach(
      everyone: on.contains { $0.subject == "everyone" },
      groupIds: Set(on.compactMap(\.groupId)),
      memberIds: Set(on.compactMap(\.memberId)),
      level: on.contains { $0.level == "edit" } ? "edit" : "view")
  }
}

// Who one shared thing reaches, as the sheet sets it whole.
nonisolated struct Reach: Equatable, Sendable {
  var everyone = false
  var groupIds: Set<String> = []
  var memberIds: Set<String> = []
  var level = "view"

  var isShared: Bool { everyone || !groupIds.isEmpty || !memberIds.isEmpty }
}

// Where an upload goes and what it carries to be let in: the machine's own
// door and a ticket for it. The bytes never pass through the site.
nonisolated struct UploadTarget: Decodable, Sendable {
  var door: String
  var ticket: String
}

// What a save answered: the file's size and when it now says it changed.
nonisolated struct Written: Decodable, Sendable {
  var size: Int
  var modified: String
}

// A save that fell behind: the file changed since it was opened, at this
// time, and was not written over.
nonisolated struct FileBehind: Error, Sendable {
  var modified: String
}

extension API {
  // One of the site's own doors, carrying the session.
  func filesRequest(_ path: String, _ query: [String: String] = [:]) -> URLRequest {
    var url = server.appending(path: path)
    if !query.isEmpty {
      url.append(queryItems: query.map { URLQueryItem(name: $0.key, value: $0.value) })
    }
    var request = URLRequest(url: url)
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    return request
  }

  // What a door answered, or its own sentence as a refusal.
  func filesAsk(_ request: URLRequest) async throws -> Data {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw Failure.unreachable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    switch status {
    case 200..<300: return data
    case 401: throw Failure.signedOut
    case 409 where request.httpMethod == "PUT":
      struct Fell: Decodable { var modified: String }
      if let fell = try? JSONDecoder().decode(Fell.self, from: data) {
        throw FileBehind(modified: fell.modified)
      }
      throw said(data, status)
    default: throw said(data, status)
    }
  }

  private func said(_ data: Data, _ status: Int) -> Failure {
    let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? .status(status) : .refused(text)
  }

  private func filesRead<T: Decodable>(_ request: URLRequest) async throws -> T {
    try JSONDecoder().decode(T.self, from: try await filesAsk(request))
  }

  // What one folder holds, each thing carrying the path it was found at.
  func folder(at path: String, in source: FileSource) async throws -> [FileEntry] {
    let entries: [FileEntry] = try await filesRead(
      filesRequest(source.door("list"), ["path": path.isEmpty ? "." : path]))
    return entries.map { entry in
      var it = entry
      it.path = path.isEmpty ? entry.name : "\(path)/\(entry.name)"
      return it
    }
  }

  // What colleagues shared with the person, by whom.
  func sharedFiles() async throws -> [Colleague] {
    try await filesRead(filesRequest("/computer/files/shared"))
  }

  // Who the person's things can be given to, and what each reaches now.
  func fileSharing() async throws -> Sharing {
    try await filesRead(filesRequest("/computer/files/share"))
  }

  // Sets what one thing of the person's own reaches, whole: whoever is
  // left off is taken off in the same act.
  func shareFile(at path: String, to reach: Reach) async throws {
    var request = filesRequest("/computer/files/share")
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "path": path,
      "everyone": reach.everyone,
      "groups": Array(reach.groupIds),
      "members": Array(reach.memberIds),
      "level": reach.level,
    ])
    _ = try await filesAsk(request)
  }

  // One file as text, where it is text.
  func fileText(at path: String, in source: FileSource) async throws -> String {
    let data = try await filesAsk(filesRequest(source.door("read"), ["path": path]))
    return String(decoding: data, as: UTF8.self)
  }

  // A small file written whole. A save that names when the file was last
  // changed as it was opened is refused as FileBehind if it changed since.
  func writeFile(at path: String, in source: FileSource, text: String, opened: String?)
    async throws -> Written
  {
    var request = filesRequest(source.door("write"), ["path": path])
    request.httpMethod = "PUT"
    request.httpBody = Data(text.utf8)
    if let opened { request.setValue(opened, forHTTPHeaderField: "x-maslow-opened") }
    return try JSONDecoder().decode(Written.self, from: try await filesAsk(request))
  }

  // One file into a temporary file of its own, which QuickLook opens: as
  // it is, or as the whole PDF the machine makes of it.
  func downloadFile(at path: String, in source: FileSource, named name: String, asPDF: Bool)
    async throws -> URL
  {
    let request = filesRequest(source.door(asPDF ? "pdf" : "read"), ["path": path])
    let temp: URL
    let response: URLResponse
    do {
      (temp, response) = try await URLSession.shared.download(for: request)
    } catch {
      throw Failure.unreachable
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard 200..<300 ~= status else {
      let data = (try? Data(contentsOf: temp)) ?? Data()
      if status == 401 { throw Failure.signedOut }
      throw said(data, status)
    }
    let folder = URL.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let kept = folder.appending(path: asPDF ? "\(name).pdf" : name)
    try FileManager.default.moveItem(at: temp, to: kept)
    return kept
  }

  // Where the phone sends an upload, and the ticket it carries.
  func fileUploadTarget(in source: FileSource) async throws -> UploadTarget {
    var request = filesRequest(source.door("upload"))
    request.httpMethod = "POST"
    return try JSONDecoder().decode(UploadTarget.self, from: try await filesAsk(request))
  }
}

// A file goes up in pieces this big, so a dropped connection loses at most
// one piece and picks up from the last the door kept.
private nonisolated let piece = 8 * 1024 * 1024

// Sends one file straight to the machine's door in pieces, carrying on
// from what the door already has. The bytes never pass through the site.
nonisolated func sendToDoor(
  _ target: UploadTarget, path: String, bytes: Data, modified: Int,
  sent: @escaping @Sendable (Int) -> Void
) async throws {
  let total = bytes.count
  let where_ =
    "\(target.door)/upload?path=\(path.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? path)&total=\(total)&modified=\(modified)"
  func ask(_ request: URLRequest) async throws -> (Int, Data) {
    var carried = request
    carried.setValue(target.ticket, forHTTPHeaderField: "x-maslow-ticket")
    let data: Data
    let response: URLResponse
    do {
      (data, response) =
        carried.httpMethod == "PUT"
        ? try await URLSession.shared.upload(for: carried, from: carried.httpBody ?? Data())
        : try await URLSession.shared.data(for: carried)
    } catch {
      throw API.Failure.unreachable
    }
    return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
  }
  struct Have: Decodable { var have: Int }
  func have() async throws -> Int {
    let (status, data) = try await ask(URLRequest(url: URL(string: where_)!))
    guard 200..<300 ~= status else {
      throw API.Failure.refused(String(decoding: data, as: UTF8.self))
    }
    return (try? JSONDecoder().decode(Have.self, from: data))?.have ?? 0
  }
  var done = try await have()
  var stumbles = 0
  // An empty file is one piece of nothing, sent so that it exists.
  var landed = false
  while done < total || (total == 0 && !landed) {
    do {
      var request = URLRequest(url: URL(string: "\(where_)&offset=\(done)&total=\(total)")!)
      request.httpMethod = "PUT"
      request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
      request.httpBody = bytes[done..<min(done + piece, total)]
      let (status, data) = try await ask(request)
      if status == 201 {
        done = total
        landed = true
      } else if 200..<300 ~= status || status == 409 {
        done = (try? JSONDecoder().decode(Have.self, from: data))?.have ?? done
        landed = true
      } else {
        throw API.Failure.refused(
          String(decoding: data, as: UTF8.self).isEmpty
            ? "The door answered \(status)." : String(decoding: data, as: UTF8.self))
      }
      stumbles = 0
    } catch {
      stumbles += 1
      if stumbles > 5 { throw error }
      try? await Task.sleep(for: .milliseconds(1500))
      done = (try? await have()) ?? done
    }
    sent(done)
  }
}
