import Foundation
import Testing

@testable import Maslow

// What the doors answer decodes as the phone expects, including dates with
// and without fractions of a second and a field of any shape.
struct DecodingTests {
  private func decode<T: Decodable>(_ json: String) throws -> T {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .custom { decoder in
      let s = try decoder.singleValueContainer().decode(String.self)
      if let date = try? Date(s, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) {
        return date
      }
      return try Date(s, strategy: .iso8601)
    }
    return try d.decode(T.self, from: Data(json.utf8))
  }

  @Test func `a page of records decodes`() throws {
    let page: Page = try decode(
      """
      {"cursor":null,"records":[{"id":"pfm7yjhp1x","type":"person","title":"Wile Coyote","opening":"",
      "updatedAt":"2026-09-17T20:15:00.720Z","ownerId":"u1","owner":null}]}
      """)
    #expect(page.records.count == 1)
    #expect(page.records[0].title == "Wile Coyote")
  }

  @Test func `a record's fields take any shape`() throws {
    let whole: Whole = try decode(
      """
      {"record":{"id":"pfm7yjhp1x","type":"person","source":"seed","sourceRef":"person:wile","title":"Wile",
      "body":"","props":{"emails":["a@b.c"],"n":3,"ok":true,"none":null},
      "createdAt":"2026-09-17T20:15:00.720Z","updatedAt":"2026-09-17T20:15:00.720Z",
      "ownerId":"u1","access":"owner"},"links":[{"id":"e1","verb":"owes","out":true,
      "record":{"id":"dfv76zkvqq","type":"person","title":"Road Runner"}}]}
      """)
    #expect(whole.record.props["emails"]?.text == "a@b.c")
    #expect(whole.record.props["n"]?.text == "3")
    #expect(whole.record.props["ok"]?.text == "Yes")
    #expect(whole.record.props["none"] == .null)
    #expect(whole.links[0].record.title == "Road Runner")
  }
}
