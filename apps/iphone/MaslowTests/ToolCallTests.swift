import Foundation
import Testing

@testable import Maslow

// Every kind of step Claude Code takes, as the adapter announces it, folds
// into the transcript the thread reads from.
struct ToolCallTests {
  private func update(_ json: String) throws -> AgentUpdate {
    try JSONDecoder().decode(AgentUpdate.self, from: Data(json.utf8))
  }

  private func fold(_ lines: [String]) throws -> [TranscriptItem] {
    var items: [TranscriptItem] = []
    for line in lines { items.fold(try update(line)) }
    return items
  }

  private func call(_ items: [TranscriptItem], _ at: Int) -> (ToolCall, String?)? {
    guard items.indices.contains(at), case .tool(let call, let under) = items[at].kind
    else { return nil }
    return (call, under)
  }

  @Test func `every kind the protocol names decodes, and an unknown one is other`() throws {
    let named = [
      "read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode",
      "other",
    ]
    for kind in named {
      let one = try update(
        #"{"sessionUpdate":"tool_call","toolCallId":"t","title":"x","kind":"\#(kind)"}"#)
      #expect(one.kind?.rawValue == kind)
      #expect(!one.kind!.asking.isEmpty)
      #expect(!one.kind!.mark.isEmpty)
    }
    let odd = try update(
      #"{"sessionUpdate":"tool_call","toolCallId":"t","title":"x","kind":"teleport"}"#)
    #expect(odd.kind == .other)
  }

  @Test func `a status the protocol does not name is waiting`() throws {
    let odd = try update(
      #"{"sessionUpdate":"tool_call","toolCallId":"t","title":"x","status":"queued"}"#)
    #expect(odd.status == .pending)
    let going = try update(
      #"{"sessionUpdate":"tool_call","toolCallId":"t","title":"x","status":"in_progress"}"#)
    #expect(going.status == .inProgress)
  }

  @Test func `a step announced twice is one row, and its result changes it in place`() throws {
    let items = try fold([
      #"{"sessionUpdate":"tool_call","toolCallId":"a","title":"ls","kind":"execute","status":"pending","_meta":{"claudeCode":{"toolName":"Bash"}}}"#,
      #"{"sessionUpdate":"tool_call","toolCallId":"a","title":"ls -la ~","kind":"execute","status":"pending","_meta":{"claudeCode":{"toolName":"Bash"}}}"#,
      #"{"sessionUpdate":"tool_call_update","toolCallId":"a","status":"completed","content":[{"type":"content","content":{"type":"text","text":"one\ntwo"}}]}"#,
    ])
    #expect(items.count == 1)
    let (one, _) = call(items, 0)!
    #expect(one.said == "ls -la ~")
    #expect(one.status == .completed)
    #expect(one.content.first?.content?.words == "one\ntwo")
  }

  @Test func `a result for a step never announced is let go`() throws {
    let items = try fold([
      #"{"sessionUpdate":"tool_call_update","toolCallId":"ghost","status":"completed"}"#
    ])
    #expect(items.isEmpty)
  }

  @Test func `a change to a file and a terminal of the agent's each decode`() throws {
    let items = try fold([
      #"{"sessionUpdate":"tool_call","toolCallId":"e","title":"Edit","kind":"edit","content":[{"type":"diff","path":"/home/me/a.txt","oldText":"was","newText":"is"}]}"#,
      #"{"sessionUpdate":"tool_call","toolCallId":"b","title":"echo hi","kind":"execute","content":[{"type":"terminal","terminalId":"term-1"}]}"#,
    ])
    let (edit, _) = call(items, 0)!
    #expect(edit.content.first?.path == "/home/me/a.txt")
    #expect(edit.content.first?.newText == "is")
    let (bash, _) = call(items, 1)!
    #expect(bash.content.first?.terminalId == "term-1")
  }

  @Test func `a subagent's steps stand under it until it answers`() throws {
    let items = try fold([
      #"{"sessionUpdate":"tool_call","toolCallId":"task","title":"Task","kind":"other","status":"in_progress","_meta":{"claudeCode":{"toolName":"Task"}}}"#,
      #"{"sessionUpdate":"tool_call","toolCallId":"in","title":"echo sub","kind":"execute","status":"pending","_meta":{"claudeCode":{"toolName":"Bash"}}}"#,
      #"{"sessionUpdate":"tool_call_update","toolCallId":"task","status":"completed"}"#,
      #"{"sessionUpdate":"tool_call","toolCallId":"after","title":"ls","kind":"execute","status":"pending","_meta":{"claudeCode":{"toolName":"Bash"}}}"#,
    ])
    #expect(call(items, 0)!.1 == nil)
    #expect(call(items, 1)!.1 == "task")
    #expect(call(items, 2)!.1 == nil)
    #expect(call(items, 0)!.0.said == "A subagent")
  }

  @Test func `a tool of a server on the machine reads as the server and the tool`() throws {
    let items = try fold([
      #"{"sessionUpdate":"tool_call","toolCallId":"m","title":"mcp__brain__search","kind":"other","_meta":{"claudeCode":{"toolName":"mcp__brain__search"}}}"#,
      #"{"sessionUpdate":"tool_call","toolCallId":"s","title":"Skill","kind":"other","_meta":{"claudeCode":{"toolName":"Skill"}}}"#,
      #"{"sessionUpdate":"tool_call","toolCallId":"g","title":"grep \"line\" a.txt","kind":"search","_meta":{"claudeCode":{"toolName":"Grep"}}}"#,
    ])
    #expect(call(items, 0)!.0.said == "brain › search")
    #expect(call(items, 1)!.0.said == "Using a skill")
    #expect(call(items, 2)!.0.said == "grep \"line\" a.txt")
  }

  @Test func `the plan changes in place rather than stacking up`() throws {
    let items = try fold([
      #"{"sessionUpdate":"plan","entries":[{"content":"one","status":"in_progress"},{"content":"two","status":"pending"}]}"#,
      #"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"working"}}"#,
      #"{"sessionUpdate":"plan","entries":[{"content":"one","status":"completed"},{"content":"two","status":"completed"}]}"#,
    ])
    #expect(items.count == 2)
    guard case .plan(let entries) = items[0].kind else { Issue.record("no plan"); return }
    #expect(entries.filter(\.done).count == 2)
  }

  @Test func `what the agent says runs together and what the person says does not`() throws {
    let items = try fold([
      #"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hel"}}"#,
      #"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"lo"}}"#,
      #"{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"hi"}}"#,
      #"{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"again"}}"#,
      #"{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"a "}}"#,
      #"{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thought"}}"#,
    ])
    #expect(items.count == 4)
    guard case .said(false, let said) = items[0].kind else { Issue.record("no words"); return }
    #expect(said == "Hello")
    guard case .thought(let thought) = items[3].kind else { Issue.record("no thought"); return }
    #expect(thought == "a thought")
  }

  @Test func `a picture handed over is a word for none, and a file is its name`() throws {
    let items = try fold([
      #"{"sessionUpdate":"user_message_chunk","content":{"type":"image","data":"AAAA","mimeType":"image/png"}}"#,
      #"{"sessionUpdate":"user_message_chunk","content":{"type":"resource_link","uri":"file:///home/me/a.txt","name":"a.txt"}}"#,
    ])
    #expect(items.count == 1)
    guard case .said(true, let said) = items[0].kind else { Issue.record("no words"); return }
    #expect(said == "a.txt")
  }

  @Test func `what the door says of a conversation is not a step`() throws {
    let items = try fold([
      #"{"sessionUpdate":"current_mode_update","currentModeId":"default"}"#,
      #"{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"clear"}]}"#,
    ])
    #expect(items.isEmpty)
  }

  @Test func `how a command ended is said only when it did not end well`() throws {
    let fine = try JSONDecoder().decode(
      TerminalSaid.self,
      from: Data(#"{"id":"t","output":"ok","exitStatus":{"exitCode":0,"signal":null}}"#.utf8))
    #expect(fine.how == "")
    let bad = try JSONDecoder().decode(
      TerminalSaid.self,
      from: Data(#"{"id":"t","output":"","exitStatus":{"exitCode":2,"signal":null}}"#.utf8))
    #expect(bad.how == " (exit 2)")
    let stopped = try JSONDecoder().decode(
      TerminalSaid.self,
      from: Data(#"{"id":"t","output":"","exitStatus":{"exitCode":null,"signal":"SIGKILL"}}"#.utf8))
    #expect(stopped.how == " (stopped)")
  }

  @Test func `leave to act is weighed allow, always, then refusing`() throws {
    let options = try JSONDecoder().decode(
      [PermissionOption].self,
      from: Data(
        #"[{"optionId":"3","name":"No, tell Claude","kind":"reject_once"},{"optionId":"1","name":"Yes","kind":"allow_once"},{"optionId":"2","name":"Yes, and don't ask again","kind":"allow_always"}]"#
          .utf8))
    #expect(options.sorted { $0.weight < $1.weight }.map(\.said) == ["Allow", "Always", "No"])
  }
}
