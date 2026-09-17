// The Agent Client Protocol as this page speaks it: what Claude Code says
// down the socket while it works, and the transcript those words build.

// A piece of what was said: text, a picture the person handed over, or a
// file of theirs carried along with the words.
export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | {
      type: "resource";
      resource: { uri: string; text?: string; mimeType?: string };
    }
  | { type: "resource_link"; uri: string; name: string };

// What a tool call is doing, which decides how its row reads.
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

// What a tool call has to show: what it said, a change to a file, or a
// terminal of the client's, which we do not give it.
type ToolContent =
  | { type: "content"; content: Content }
  | { type: "diff"; path: string; oldText: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

export type ToolCall = {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolStatus;
  content: ToolContent[];
  // What Claude Code calls the tool, which says where the work is done:
  // its own hand, or a tool of an MCP server on the machine.
  toolName?: string;
};

export type PlanEntry = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type Mode = { id: string; name: string; description?: string | null };

export type Command = { name: string; description?: string };

export type PermissionOption = {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
};

// A conversation the agent keeps, as its own list has it.
export type Past = {
  sessionId: string;
  title: string | null;
  updatedAt?: string;
};

// Everything the agent tells the client about a session, in its own words.
export type Update =
  | { sessionUpdate: "agent_message_chunk"; content: Content }
  | { sessionUpdate: "user_message_chunk"; content: Content }
  | { sessionUpdate: "agent_thought_chunk"; content: Content }
  | ({ sessionUpdate: "tool_call" } & ToolCall & {
        _meta?: { claudeCode?: { toolName?: string } };
      })
  | ({ sessionUpdate: "tool_call_update" } & Partial<ToolCall> & {
        toolCallId: string;
      })
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  // A question the agent asked the person, standing until answered: the
  // door's own word, one ask of the brain's.
  | {
      sessionUpdate: "_maslow/asked";
      id: string;
      title: string;
      body: string;
      options: string[];
    }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | {
      sessionUpdate: "available_commands_update";
      availableCommands: Command[];
    };

// What one of the agent's terminals has written, as the door says it: the
// command's output so far, whether the door had to stop keeping it, and
// how it ended once it has.
export type Terminal = {
  id: string;
  output: string;
  truncated?: boolean;
  exitStatus?: { exitCode: number | null; signal: string | null } | null;
};

export type Word = {
  clear?: boolean;
  state?: "off" | "starting" | "ready" | "failed";
  why?: string | null;
  // Every conversation the door holds open, when a socket arrives; a door
  // from before spoke of one `session` instead.
  chats?: ChatSaid[];
  session?: unknown;
  // One conversation changed: opened afresh (clear), gone to sleep
  // (gone), running or not, its modes, its name, or how full it is.
  chat?: Partial<ChatSaid> & {
    id: string;
    clear?: boolean;
    gone?: boolean;
    context?: Context | null;
    // An ask answered elsewhere, by the notification's id.
    answered?: string;
  };
  terminal?: Terminal;
  // What a socket asks of the door rather than of the agent.
  fresh?: boolean;
  open?: string;
  close?: string;
  name?: { id: string; title: string };
};

// A conversation as the door tells of it.
type ChatSaid = {
  id: string;
  running: boolean;
  modes: { currentModeId: string; availableModes: Mode[] } | null;
  title: string | null;
};

// How full a conversation is, as the door reckons it from Claude Code's
// own record on the machine: about, by token bucket.
export type Context = {
  max: number;
  segments: { label: string; tokens: number }[];
};

// One thing in the transcript. A message grows as its chunks arrive; a
// tool row, a plan and an ask each change in place.
export type Item =
  | { kind: "said"; id: number; who: "person" | "agent"; text: string }
  | { kind: "thought"; id: number; text: string }
  | {
      kind: "tool";
      id: number;
      call: ToolCall;
      // The subagent this step was taken inside, where it was taken
      // inside one: the protocol has no place for it, so the order the
      // steps arrive in is what says so.
      under?: string;
    }
  | { kind: "plan"; id: number; entries: PlanEntry[] };

// What a piece of content reads as, whatever kind it is: a picture is a
// word for one, since the transcript is written, not drawn.
function textOf(content: Content | undefined): string {
  if (!content) return "";
  if (content.type === "text") return content.text;
  if (content.type === "image") return "";
  if (content.type === "resource") return content.resource.text ?? "";
  if (content.type === "resource_link") return content.name;
  return "";
}

// The subagent still working, if any: its steps arrive between its own
// call and its result, as plain steps of their own, so what came after it
// and before its answer is what it did.
function inside(items: Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const one = items[i]!;
    if (one.kind !== "tool" || one.call.toolName !== "Task") continue;
    const done =
      one.call.status === "completed" || one.call.status === "failed";
    return done ? undefined : one.call.toolCallId;
  }
  return undefined;
}

// The transcript with one more of the agent's words folded into it.
export function fold(items: Item[], update: Update): Item[] {
  const id = items.length;
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = textOf(update.content);
      if (!text) return items;
      const last = items.at(-1);
      if (last?.kind === "said" && last.who === "agent")
        return [...items.slice(0, -1), { ...last, text: last.text + text }];
      return [...items, { kind: "said", id, who: "agent", text }];
    }
    // What the person said arrives whole, one message to a turn, so two in
    // a row are two messages and never one run together.
    case "user_message_chunk": {
      const text = textOf(update.content);
      return text
        ? [...items, { kind: "said", id, who: "person", text }]
        : items;
    }
    case "agent_thought_chunk": {
      const text = textOf(update.content);
      if (!text) return items;
      const last = items.at(-1);
      if (last?.kind === "thought")
        return [...items.slice(0, -1), { ...last, text: last.text + text }];
      return [...items, { kind: "thought", id, text }];
    }
    case "tool_call": {
      // A call is announced as soon as the agent starts writing its input
      // and again once it is whole, so the second announcement changes the
      // row rather than adding another.
      const call = {
        toolCallId: update.toolCallId,
        title: update.title ?? "Working",
        kind: update.kind ?? "other",
        status: update.status ?? "pending",
        content: update.content ?? [],
        toolName: update._meta?.claudeCode?.toolName,
      };
      const at = items.findIndex(
        (i) => i.kind === "tool" && i.call.toolCallId === update.toolCallId,
      );
      if (at < 0)
        return [...items, { kind: "tool", id, call, under: inside(items) }];
      const was = items[at]!;
      const next = [...items];
      next[at] = {
        kind: "tool",
        id: was.id,
        call,
        under: was.kind === "tool" ? was.under : undefined,
      };
      return next;
    }
    case "tool_call_update": {
      const at = items.findIndex(
        (i) => i.kind === "tool" && i.call.toolCallId === update.toolCallId,
      );
      const was = items[at];
      if (was?.kind !== "tool") return items;
      const next = [...items];
      next[at] = {
        ...was,
        under: was.under,
        call: {
          ...was.call,
          ...(update.title !== undefined ? { title: update.title } : {}),
          ...(update.kind !== undefined ? { kind: update.kind } : {}),
          ...(update.status !== undefined ? { status: update.status } : {}),
          // Content arrives whole rather than in pieces, so what came last
          // is what the row shows.
          ...(update.content?.length ? { content: update.content } : {}),
        },
      };
      return next;
    }
    case "plan": {
      const at = items.findIndex((i) => i.kind === "plan");
      if (at < 0)
        return [...items, { kind: "plan", id, entries: update.entries }];
      const next = [...items];
      next[at] = { kind: "plan", id: items[at]!.id, entries: update.entries };
      return next;
    }
    default:
      return items;
  }
}
