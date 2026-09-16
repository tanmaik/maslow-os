// Two tools of the door's own, handed to every conversation the Agent
// window opens, since neither crosses the protocol Claude Code is spoken
// to over: a wakeup, which prompts the conversation again after a while,
// and a monitor, which runs a command and prompts it with each line the
// command writes. This is the small server Claude Code starts beside a
// conversation, over stdio as an MCP server; every call is handed to the
// door on the machine's own loopback, under the token the door gave this
// conversation, and the door does the work and keeps the record.
import { createInterface } from "node:readline";

const DOOR = "http://127.0.0.1:8080/maslow/tools";
const TOKEN = process.env.MASLOW_TOOL_TOKEN ?? "";

const TOOLS = [
  {
    name: "schedule_wakeup",
    description:
      "Wake this conversation up after a delay: the prompt is sent to you then, as if the person had typed it. Use it to check on something later, to keep a loop going, or to pace yourself. One wakeup at a time per conversation; a new one replaces the last.",
    inputSchema: {
      type: "object",
      properties: {
        delay_seconds: {
          type: "number",
          description: "Seconds from now, 30 to 86400.",
        },
        prompt: {
          type: "string",
          description: "What to say to yourself when it fires.",
        },
      },
      required: ["delay_seconds", "prompt"],
    },
  },
  {
    name: "monitor",
    description:
      "Run a shell command in the background as the person and be prompted with each line it prints, as it prints it, until it ends or is stopped. The command's stdout is the event stream: filter it to the lines worth acting on.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "A bash command." },
        description: {
          type: "string",
          description: "What is being watched, in a few words.",
        },
      },
      required: ["command", "description"],
    },
  },
  {
    name: "stop_monitor",
    description: "Stop a monitor by the id monitor gave back.",
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
