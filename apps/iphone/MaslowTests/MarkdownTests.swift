import Foundation
import Testing

@testable import Maslow

// A body's markdown comes apart into the blocks a page lays out.
struct MarkdownTests {
  @Test func `headings, lists and paragraphs are told apart`() {
    let blocks = MarkdownBlock.parse(
      """
      # Title

      A paragraph with **bold**.

      - one
      - two

      1. first

      > quoted

      ```
      code
      ```
      """)
    #expect(blocks.map(\.kind) == [.heading(1), .paragraph, .bullet, .bullet, .numbered(1), .quote, .code])
    #expect(String(blocks[0].text.characters) == "Title")
  }

  @Test func `plain text is one paragraph`() {
    let blocks = MarkdownBlock.parse("just words")
    #expect(blocks.count == 1)
    #expect(blocks[0].kind == .paragraph)
  }
}
