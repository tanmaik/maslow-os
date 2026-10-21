import Foundation
import Observation
import SwiftUI

// What the person hands the agent with their next words. A picture rides
// in the prompt itself, as the protocol carries one; anything else is put
// on their computer first, in their own Attachments folder, and the prompt
// says where it landed, so Claude Code reads it there with its own hands.

// Where the agent works, and where a file of theirs is put.
private let home = "/home/me"
private let folder = "Attachments"

nonisolated struct Attached: Identifiable, Sendable {
  let id = UUID()
  var name: String
  var part: PromptPart?
  var landing: Bool { part == nil }
}

@Observable
final class Attachments {
  private(set) var held: [Attached] = []
  // Why a file could not be attached.
  private(set) var why: String?

  var ready: Bool { held.allSatisfy { !$0.landing } }
  var parts: [PromptPart] { held.compactMap(\.part) }

  func clear() {
    held = []
    why = nil
  }

  // Why a file could not be attached, said on screen until the next try.
  func blame(_ said: String) {
    why = said
  }

  func remove(_ id: Attached.ID) {
    held.removeAll { $0.id == id }
  }

  // A picture, carried in the words themselves.
  func add(picture data: Data, named name: String, type: String) {
    held.append(
      Attached(name: name, part: .image(data: data.base64EncodedString(), mimeType: type)))
  }

  // A file, put on the computer and named to the agent once it is there.
  func add(file data: Data, named name: String, with api: API) async {
    why = nil
    let one = Attached(name: name)
    held.append(one)
    do {
      let part = try await put(data, named: name, with: api)
      guard let at = held.firstIndex(where: { $0.id == one.id }) else { return }
      held[at].part = part
    } catch {
      held.removeAll { $0.id == one.id }
      why = "\(name) could not be put on your computer: \(error.localizedDescription)"
    }
  }

  private func put(_ data: Data, named name: String, with api: API) async throws -> PromptPart {
    let target = try await api.uploadTarget()
    let at = "\(folder)/\(name)"
    var url = URLComponents(string: target.door + "/upload")!
    url.queryItems = [
      URLQueryItem(name: "path", value: at),
      URLQueryItem(name: "total", value: String(data.count)),
      URLQueryItem(name: "modified", value: String(Int(Date.now.timeIntervalSince1970 * 1000))),
      URLQueryItem(name: "offset", value: "0"),
    ]
    guard let address = url.url else { throw API.Failure.unreachable }
    var request = URLRequest(url: address)
    request.httpMethod = "PUT"
    request.setValue(target.ticket, forHTTPHeaderField: "x-maslow-ticket")
    request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
    let (_, answer) = try await URLSession.shared.upload(for: request, from: data)
    let status = (answer as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 201 else { throw API.Failure.status(status) }
    return .file(uri: "file://\(home)/\(at)", name: name)
  }
}

// The files waiting on the next prompt, each with a way to take it off.
struct HeldStrip: View {
  let held: [Attached]
  let onRemove: (Attached.ID) -> Void

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(held) { one in
          HStack(spacing: 6) {
            if one.landing {
              ProgressView().controlSize(.small)
            } else {
              Image(systemName: "paperclip").imageScale(.small)
            }
            Text(one.name).font(.caption).lineLimit(1)
            Button("Take off \(one.name)", systemImage: "xmark") { onRemove(one.id) }
              .labelStyle(.iconOnly)
              .buttonStyle(.plain)
              .imageScale(.small)
              .foregroundStyle(.secondary)
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(.fill.quaternary, in: .capsule)
        }
      }
      .padding(.horizontal, 2)
    }
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
  }
}
