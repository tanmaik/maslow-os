// Two tools of the door's own, handed to every conversation the Agent
// window opens, since neither crosses the protocol Claude Code is spoken
// to over: a wakeup, which prompts the conversation again after a while or
// with what a command prints, and stop, which ends one. This is the small
// server Claude Code starts beside a conversation, over stdio as an MCP
// server; every call is handed to the door on the machine's own loopback,
// under the token the door gave this conversation, and the door does the
// work and keeps the record.
import { createInterface } from "node:readline";

const DOOR = "http://127.0.0.1:8080/maslow/tools";
const TOKEN = process.env.MASLOW_TOOL_TOKEN ?? "";

const TOOLS = [
  {
    name: "wakeup",
    description:
      "Be prompted again later, as if the person had typed it. With delay_seconds and prompt, the prompt is said to you when the time is up; one such wakeup per conversation, a new one replacing the last. With command instead, the command runs in the background as the person and every line it prints reaches you as it comes, a second's worth at a time, until it ends or is stopped; pattern keeps only the lines matching a regular expression, so watch for the lines worth acting on. A wakeup outlives your turn and the conversation's sleep, and wakes it. Answers with the id stop takes.",
    inputSchema: {
      type: "object",
      properties: {
        delay_seconds: {
          type: "number",
          description: "Seconds from now, 30 to 86400, with a prompt.",
        },
        prompt: {
          type: "string",
          description: "What to say to yourself when the time is up.",
        },
        command: {
          type: "string",
          description: "A bash command to watch, instead of a delay.",
        },
        pattern: {
          type: "string",
          description:
            "A regular expression; only the lines matching it reach you.",
        },
      },
    },
  },
  {
    name: "stop",
    description:
      "Stops a wakeup by the id wakeup gave back: a delay not yet up, or a command being watched.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function call(name, args) {
  const res = await fetch(DOOR, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN, tool: name, args }),
  });
  const text = await res.text();
  return { content: [{ type: "text", text }], isError: !res.ok };
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;
  const answer = (result) => out({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize":
      return answer({
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "maslow", version: "1" },
      });
    case "tools/list":
      return answer({ tools: TOOLS });
    case "tools/call":
      try {
        return answer(
          await call(msg.params?.name, msg.params?.arguments ?? {}),
        );
      } catch (err) {
        return answer({
          content: [
            {
              type: "text",
              text: `The door did not answer: ${err?.message ?? err}`,
            },
          ],
          isError: true,
        });
      }
    case "ping":
      return answer({});
    default:
      return out({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Method not found" },
      });
  }
});
