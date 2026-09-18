import SwiftUI

// A record's body, which is markdown, as blocks a page can lay out:
// paragraphs, headings, lists, quotes, code and rules. Inline emphasis
// and code stay in the text.
nonisolated struct MarkdownBlock: Identifiable, Equatable {
  nonisolated enum Kind: Equatable {
    case paragraph
    case heading(Int)
    case bullet
    case numbered(Int)
    case quote
    case code
    case rule
  }
  let id: Int
  let kind: Kind
  let text: AttributedString

  nonisolated static func parse(_ markdown: String) -> [MarkdownBlock] {
    let options = AttributedString.MarkdownParsingOptions(
      allowsExtendedAttributes: true,
      interpretedSyntax: .full,
      failurePolicy: .returnPartiallyParsedIfPossible)
    guard let whole = try? AttributedString(markdown: markdown, options: options) else {
      return [MarkdownBlock(id: 0, kind: .paragraph, text: AttributedString(markdown))]
    }
    var blocks: [MarkdownBlock] = []
    for (intent, range) in whole.runs[\.presentationIntent] {
      var text = AttributedString(whole[range])
      text.presentationIntent = nil
      let kind = Self.kind(of: intent)
      if kind == .rule { blocks.append(MarkdownBlock(id: blocks.count, kind: .rule, text: "")); continue }
      if text.characters.isEmpty { continue }
      blocks.append(MarkdownBlock(id: blocks.count, kind: kind, text: text))
    }
    return blocks
  }

  private nonisolated static func kind(of intent: PresentationIntent?) -> Kind {
    guard let intent else { return .paragraph }
    var kind = Kind.paragraph
    var ordered = false
    var ordinal: Int?
    for component in intent.components {
      switch component.kind {
      case .header(let level): return .heading(level)
      case .codeBlock: return .code
      case .thematicBreak: return .rule
      case .blockQuote: kind = .quote
      case .orderedList: ordered = true
      case .listItem(let n): ordinal = n
      default: break
      }
    }
    if let ordinal { return ordered ? .numbered(ordinal) : .bullet }
    return kind
  }
}

struct MarkdownView: View {
  let blocks: [MarkdownBlock]
  @ScaledMetric(relativeTo: .body) private var indent = 8.0
  @ScaledMetric(relativeTo: .body) private var bar = 3.0

  init(_ markdown: String) {
    blocks = MarkdownBlock.parse(markdown)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(blocks) { block in
        switch block.kind {
        case .paragraph:
          Text(block.text)
        case .heading(let level):
          Text(block.text)
            .font(level <= 1 ? .title2 : level == 2 ? .title3 : .headline)
            .fontWeight(.semibold)
            .padding(.top, 4)
            .accessibilityAddTraits(.isHeader)
        case .bullet:
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").foregroundStyle(.secondary)
            Text(block.text)
          }
          .padding(.leading, indent)
        case .numbered(let n):
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(n).").foregroundStyle(.secondary).monospacedDigit()
            Text(block.text)
          }
          .padding(.leading, indent)
        case .quote:
          Text(block.text)
            .foregroundStyle(.secondary)
            .padding(.leading, indent * 1.5)
            .overlay(alignment: .leading) {
              Capsule().fill(.quaternary).frame(width: bar)
            }
        case .code:
          ScrollView(.horizontal, showsIndicators: false) {
            Text(block.text)
              .font(.callout.monospaced())
              .padding(12)
          }
          .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
          .background(
            .fill.quaternary, in: .rect(corners: .concentric(minimum: 10), isUniform: true))
        case .rule:
          Divider()
        }
      }
    }
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
