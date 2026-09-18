import Foundation

// What the doors answer, as the phone holds it.

nonisolated struct Vocabulary: Decodable, Sendable {
  var records: Int
  var types: [BrainType]
}

nonisolated struct BrainType: Decodable, Identifiable, Hashable, Sendable {
  var id: String
  var name: String
  var own: Bool
  var ownerId: String
  var owner: String?
  var records: Int
  var properties: [Property]
}

nonisolated struct Property: Decodable, Hashable, Sendable {
  var name: String
  var datatype: String
  var required: Bool
  var options: [String]?
}

nonisolated struct Page: Decodable, Sendable {
  var cursor: String?
  var records: [Stub]
}

// A record as a list shows it: the title, the first line, its last
// change.
nonisolated struct Stub: Decodable, Identifiable, Hashable, Sendable {
  var id: String
  var type: String
  var title: String
  var opening: String
  var updatedAt: Date
  var ownerId: String
  var owner: String?
}

nonisolated struct Whole: Decodable, Sendable {
  var record: Record
  var links: [Link]
}

nonisolated struct Record: Decodable, Identifiable, Sendable {
  var id: String
  var type: String
  var source: String
  var sourceRef: String
  var title: String
  var body: String
  var props: [String: JSONValue]
  var createdAt: Date
  var updatedAt: Date
  var ownerId: String
  var owner: String?
  var access: String
}

nonisolated struct Link: Decodable, Identifiable, Sendable {
  var id: String
  var verb: String
  var out: Bool
  var record: Ref
}

nonisolated struct Ref: Decodable, Identifiable, Hashable, Sendable {
  var id: String
  var type: String
  var title: String
}

nonisolated struct Notice: Decodable, Identifiable, Sendable {
  var id: String
  var kind: String
  var title: String
  var body: String
  var from: String
  var records: [String]
  var options: [String]
  var answer: String?
  var request: String?
  var readAt: Date?
  var createdAt: Date

  var isAsk: Bool { kind == "ask" }
  var waiting: Bool { isAsk && answer == nil }
}

nonisolated struct About: Decodable, Sendable {
  var version: String
  var image: String
  var machine: String?
  var `where`: String?
  var size: String?
  var diskGb: Int?
}

// A field's value as the record holds it, whatever the field declares.
nonisolated enum JSONValue: Decodable, Hashable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let b = try? c.decode(Bool.self) {
      self = .bool(b)
    } else if let n = try? c.decode(Double.self) {
      self = .number(n)
    } else if let s = try? c.decode(String.self) {
      self = .string(s)
    } else if let a = try? c.decode([JSONValue].self) {
      self = .array(a)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }

  // The value as a person reads it.
  var text: String {
    switch self {
    case .string(let s): s
    case .number(let n): n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
    case .bool(let b): b ? "Yes" : "No"
    case .null: ""
    case .array(let a): a.map(\.text).joined(separator: ", ")
    case .object(let o): o.keys.sorted().map { "\($0): \(o[$0]!.text)" }.joined(separator: ", ")
    }
  }
}
