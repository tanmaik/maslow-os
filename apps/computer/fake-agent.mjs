// The faked agent: an ACP agent that answers every prompt the same way, with
// a tool call, a subagent that runs one command, and a sentence, so a
// checkout without a model key still has a working conversation and the
// smoke has something to check. A moment after each answer it wakes on its
// own and says one more thing, the way the real harness does after a wakeup
// it scheduled. Never in production, where a missing key stops the app
// instead.
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Sessions told to stop mid-turn, and each session's pending wakeup.
const cancelled = new Set();
const wakeups = new Map();
const CANCELLED = Symbol("cancelled");

const app = acp
  .agent({ name: "placeholder-fake-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
    agentInfo: { name: "fake-agent", title: "Faked agent", version: "0" },
  }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: randomUUID() }))
  .onRequest(acp.methods.agent.session.load, () => ({}))
  .onRequest(acp.methods.agent.session.setMode, () => ({}))
  .onNotification(acp.methods.agent.session.cancel, (ctx) => {
    cancelled.add(ctx.params.sessionId);
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const { sessionId, prompt } = ctx.params;
    cancelled.delete(sessionId);
    clearTimeout(wakeups.get(sessionId));
    const asked = prompt.map((c) => (c.type === "text" ? c.text : "")).join("");
    // Each turn's calls have names of their own, so two turns never share
    // a row.
    const turn = randomUUID().slice(0, 8);
    const id = (name) => `${turn}-${name}`;
    const update = (u) =>
      ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: u,
      });
    // A pause in the turn, cut short by a stop.
    const pause = async (ms) => {
      await wait(ms);
      if (cancelled.has(sessionId)) throw CANCELLED;
    };
    const say = async (text) => {
      for (const word of text.split(" ")) {
        await update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${word} ` },
        });
        await pause(20);
      }
    };
    const usage = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
    try {
      await update({
        sessionUpdate: "tool_call",
        toolCallId: id("look"),
        title: "Looked at the disk",
        kind: "read",
        status: "in_progress",
        locations: [{ path: process.env.HOME ?? "/" }],
      });
      await pause(150);
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: id("look"),
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "A disk, with nothing the faked agent can read.",
            },
          },
        ],
      });
      // A subagent, as the harness reports one: the call that spawns it, the
      // command it runs stamped with that call, and its report with its bill.
      await update({
        sessionUpdate: "tool_call",
        toolCallId: id("helper"),
        title: "Count the files",
        kind: "think",
        status: "in_progress",
        rawInput: {
          description: "Count the files",
          prompt: "Count the files.",
        },
        _meta: { claudeCode: { toolName: "Agent", subagent: true } },
      });
      await update({
        sessionUpdate: "tool_call",
        toolCallId: id("helper-ls"),
        title: "ls",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "ls" },
        _meta: {
          claudeCode: { toolName: "Bash", parentToolUseId: id("helper") },
        },
      });
      await pause(100);
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: id("helper-ls"),
        status: "completed",
        rawOutput: "",
        _meta: {
          claudeCode: { toolName: "Bash", parentToolUseId: id("helper") },
        },
      });
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: id("helper"),
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "No files." } },
        ],
        rawOutput: [
          { type: "text", text: "No files." },
          {
            type: "text",
            text: "agentId: fake1 (use SendMessage)\n<usage>subagent_tokens: 12\ntool_uses: 1\nduration_ms: 100</usage>",
          },
        ],
        _meta: {
          claudeCode: {
            toolName: "Agent",
            subagent: true,
            toolResponse: { subagentType: "general-purpose" },
          },
        },
      });
      await say(
        `You said: ${asked}. This is the faked agent: no model key is set here, so nothing was done.`,
      );
    } catch (err) {
      if (err !== CANCELLED) throw err;
      return { stopReason: "cancelled", usage };
    }
    // Once the turn is over, a turn of its own: a thought, a word, and the
    // cost that says the cycle ended. A new prompt first takes its place.
    const wakeup = setTimeout(async () => {
      wakeups.delete(sessionId);
      await update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "The wakeup fired." },
      });
      await say("Woke, as scheduled.").catch(() => {});
      await update({
        sessionUpdate: "usage_update",
        used: 0,
        size: 200000,
        cost: { amount: 0, currency: "USD" },
      });
    }, 1500);
    wakeup.unref();
    wakeups.set(sessionId, wakeup);
    return { stopReason: "end_turn", usage };
  });

app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin),
  ),
);
