// The conversation as rows on the page: what the machine recorded, laid out
// the way t3code lays out a thread. A turn begins with a prompt from the
// person or a wakeup the agent gave itself, and holds everything the agent
// did until it stopped. A settled turn folds its work behind how long it
// took; the turn in flight shows its work as it happens. A subagent's work
// nests under the call that spawned it; a background task is one entry that
// keeps the latest word on it.

export type AgentEvent = {
  seq: number;
  kind: string;
  body: Record<string, unknown>;
  at: string;
};

// A tool call as the agent is making it: the same shape it ends with.
export type ToolState = {
  toolCallId: string;
  title: string;
  kind?: string;
  status?: string;
  locations?: { path: string; line?: number | null }[];
  content?: unknown[];
  rawInput?: unknown;
  // The harness's own name for the tool, and the call that spawned this one.
  toolName?: string;
  parent?: string;
  // A subagent: its kind, its latest words while it runs, and its bill.
  agent?: boolean;
  agentType?: string;
  activity?: string;
  usage?: {
    tokens: number;
    toolUses: number;
    ms: number;
    agentId: string | null;
  };
  workflow?: { name: string; runId: string | null; taskId: string | null };
};

// A background task as the harness reports it: a workflow, a backgrounded
// command.
export type TaskState = {
  id: string;
  name?: string;
  taskType?: string;
  description?: string;
  state: string;
  summary?: string;
  toolCallId?: string;
};

// The turn in flight, as the socket reports it.
export type Live = {
  working: boolean;
  since: string | null;
  partial: string;
  tools: ToolState[];
  tasks: TaskState[];
};

// One thing the agent did: a tool call, with the calls a subagent made under
// it; a thought; a task it started.
export type Entry =
  | {
      id: string;
      kind: "tool";
      at: string;
      tool: ToolState;
      children: Entry[];
    }
  | { id: string; kind: "thought"; at: string; text: string }
  | { id: string; kind: "task"; at: string; task: TaskState };

export type Row =
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "wake"; id: string; at: string; reason: string; prompt: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      streaming: boolean;
      // When the message is the turn's last word, when it was said.
      meta: string | null;
    }
  | { kind: "assistant-meta"; id: string; at: string; text: string }
  | {
      kind: "fold";
      id: string;
      turn: number;
      label: string;
      expanded: boolean;
    }
  | { kind: "working"; id: string; since: string }
  | { kind: "work"; id: string; entry: Entry; inGroup: boolean }
  | {
      kind: "work-toggle";
      id: string;
      group: string;
      summary: string;
      entries: Entry[];
      expanded: boolean;
      failed: boolean;
    }
  | {
      kind: "work-live";
      id: string;
      group: string;
      label: string;
      tool: ToolState | null;
      entries: Entry[];
      expanded: boolean;
    }
  | { kind: "thinking"; id: string }
  | { kind: "restart"; id: string };

type Item = { kind: "text"; id: string; at: string; text: string } | Entry;

type Turn = {
  n: number;
  // The prompt or the wake that began it.
  start: AgentEvent;
  items: Item[];
  result: AgentEvent | null;
  restarted: boolean;
};

// Everything that has happened, cut into turns at each prompt or wake.
function turns(events: AgentEvent[]): Turn[] {
  // A task belongs to the turn it began in, however late its last word.
  const taskOf = new Map<string, Turn>();
  const out: Turn[] = [];
  let turn: Turn | null = null;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.kind === "prompt" || e.kind === "wake") {
      turn = {
        n: out.length,
        start: e,
        items: [],
        result: null,
        restarted: false,
      };
      out.push(turn);
      continue;
    }
    if (!turn) continue;
    const id = `e${e.seq}`;
    if (e.kind === "text")
      turn.items.push({ kind: "text", id, at: e.at, text: str(e.body.text) });
    else if (e.kind === "thought")
      turn.items.push({
        kind: "thought",
        id,
        at: e.at,
        text: str(e.body.text),
      });
    else if (e.kind === "tool")
      turn.items.push({
        kind: "tool",
        id,
        at: e.at,
        tool: e.body as unknown as ToolState,
        children: [],
      });
    else if (e.kind === "task") {
      const task = e.body as unknown as TaskState;
      const owner = taskOf.get(task.id) ?? turn;
      const had = owner.items.find(
        (i) => i.kind === "task" && i.task.id === task.id,
      ) as Extract<Entry, { kind: "task" }> | undefined;
      if (had) had.task = task;
      else {
        owner.items.push({ kind: "task", id, at: e.at, task });
        taskOf.set(task.id, owner);
      }
    } else if (e.kind === "result") turn.result = e;
    else if (e.kind === "restart") turn.restarted = true;
  }
  for (const t of out) nest(t);
  return out;
}

// A subagent's calls settle before the call that spawned them does, so they
// are gathered under it once the turn is read whole.
function nest(turn: Turn) {
  const tools = turn.items.filter(
    (i): i is Extract<Entry, { kind: "tool" }> => i.kind === "tool",
  );
  const byId = new Map(tools.map((t) => [t.tool.toolCallId, t]));
  turn.items = turn.items.filter((i) => {
    if (i.kind !== "tool" || !i.tool.parent) return true;
    const parent = byId.get(i.tool.parent);
    if (!parent || parent === i) return true;
    parent.children.push(i);
    return false;
  });
}

export function rows(
  events: AgentEvent[],
  live: Live,
  expandedTurns: ReadonlySet<number>,
  expandedGroups: ReadonlySet<string>,
): Row[] {
  const out: Row[] = [];
  const all = turns(events);
  for (const turn of all) {
    if (turn.start.kind === "wake")
      out.push({
        kind: "wake",
        id: `w${turn.start.seq}`,
        at: turn.start.at,
        reason: str(turn.start.body.reason),
        prompt: str(turn.start.body.prompt),
      });
    else
      out.push({
        kind: "user",
        id: `u${turn.start.seq}`,
        text: str(turn.start.body.text),
        at: turn.start.at,
      });
    const active =
      turn === all.at(-1) && !turn.result && !turn.restarted && live.working;
    if (active) activeRows(turn, live, expandedGroups, out);
    else settledRows(turn, expandedTurns, expandedGroups, out);
  }
  return out;
}

// A settled turn: its work folded behind how long it took, its last word
// shown, anything it did after that word shown too.
function settledRows(
  turn: Turn,
  expandedTurns: ReadonlySet<number>,
  expandedGroups: ReadonlySet<string>,
  out: Row[],
) {
  const { items } = turn;
  const terminal = items.findLastIndex((i) => i.kind === "text");
  const hidden = new Set<Item>();
  items.forEach((item, i) => {
    if (i < terminal || terminal === -1) hidden.add(item);
  });
  // One ordinary thing after the last word joins the fold; more, or a
  // failure, stays visible as a trailing summary.
  const after = terminal === -1 ? [] : items.slice(terminal + 1);
  const only = after.length === 1 ? after[0] : null;
  if (only && only.kind !== "text" && !failed(only)) hidden.add(only);
  const trailing = after.filter((i) => !hidden.has(i));

  // Every turn that ended says how long it took, even one stopped before
  // it did anything.
  if (hidden.size > 0 || turn.result) {
    const expanded = expandedTurns.has(turn.n);
    out.push({
      kind: "fold",
      id: `fold${turn.start.seq}`,
      turn: turn.n,
      label: foldLabel(turn),
      expanded,
    });
    if (expanded)
      itemRows(
        items.filter((i) => hidden.has(i)),
        expandedGroups,
        out,
      );
  }
  if (terminal >= 0) {
    const word = items[terminal] as Extract<Item, { kind: "text" }>;
    const at = turn.result?.at ?? word.at;
    out.push({
      kind: "assistant",
      id: word.id,
      text: word.text,
      streaming: false,
      meta: trailing.length ? null : at,
    });
    if (trailing.length) {
      itemRows(trailing, expandedGroups, out);
      out.push({
        kind: "assistant-meta",
        id: `meta${word.id}`,
        at,
        text: word.text,
      });
    }
  }
  if (turn.restarted)
    out.push({ kind: "restart", id: `restart${turn.start.seq}` });
}

// The turn in flight: how long it has been working, what it has done, what
// it is doing, and what it is saying.
function activeRows(
  turn: Turn,
  live: Live,
  expandedGroups: ReadonlySet<string>,
  out: Row[],
) {
  out.push({
    kind: "working",
    id: `working${turn.start.seq}`,
    since: live.since ?? turn.start.at,
  });
  // A running call nests under its running parent; calls a still-running
  // subagent has settled nest under it as it runs.
  const running = live.tools
    .filter((t) => !live.tools.some((p) => p.toolCallId === t.parent))
    .map((tool) => liveEntry(tool, turn.items, live.tools));
  const held = new Set<Item>(running.flatMap((e) => settled(e)));
  const items = turn.items.filter((i) => !held.has(i));
  const lastText = items.findLastIndex((i) => i.kind === "text");
  const tail = items.slice(lastText + 1) as Entry[];
  // Only a task still going is live work; a settled one is in the record.
  const tasks = live.tasks
    .filter((task) =>
      ["running", "pending", "in_progress"].includes(task.state),
    )
    .map((task): Entry => ({
      id: `task${task.id}`,
      kind: "task",
      at: "",
      task,
    }));
  if (running.length > 0 || tasks.length > 0) {
    itemRows(items.slice(0, lastText + 1), expandedGroups, out);
    const entries: Entry[] = [...tail, ...running, ...tasks];
    const group = `live${turn.start.seq}`;
    const expanded = expandedGroups.has(group);
    out.push({
      kind: "work-live",
      id: group,
      group,
      label: liveLabel(live.tools, live.tasks),
      tool: live.tools.at(-1) ?? null,
      entries,
      expanded,
    });
    if (expanded) entryRows(entries, out);
  } else itemRows(items, expandedGroups, out);
  if (live.partial)
    out.push({
      kind: "assistant",
      id: `partial${turn.start.seq}`,
      text: live.partial,
      streaming: true,
      meta: null,
    });
  else if (running.length === 0 && tasks.length === 0 && items.length === 0)
    out.push({ kind: "thinking", id: `thinking${turn.start.seq}` });
}

// A running call as an entry, with the settled calls made under it.
function liveEntry(
  tool: ToolState,
  items: Item[],
  live: ToolState[],
): Extract<Entry, { kind: "tool" }> {
  return {
    id: tool.toolCallId,
    kind: "tool",
    at: "",
    tool,
    children: [
      ...items.filter(
        (i): i is Extract<Entry, { kind: "tool" }> =>
          i.kind === "tool" && i.tool.parent === tool.toolCallId,
      ),
      ...live
        .filter((t) => t.parent === tool.toolCallId)
        .map((t) => liveEntry(t, items, live)),
    ],
  };
}

// The settled calls nested anywhere under a live entry.
function settled(e: Extract<Entry, { kind: "tool" }>): Entry[] {
  return e.children.flatMap((c) =>
    c.kind === "tool" ? [c, ...settled(c)] : [c],
  );
}

// Words as messages; consecutive doings as one group.
function itemRows(
  items: Item[],
  expandedGroups: ReadonlySet<string>,
  out: Row[],
) {
  let group: Entry[] = [];
  const flush = () => {
    if (group.length === 1)
      out.push({
        kind: "work",
        id: group[0].id,
        entry: group[0],
        inGroup: false,
      });
    else if (group.length > 1) {
      const id = `group${group[0].id}`;
      const expanded = expandedGroups.has(id);
      out.push({
        kind: "work-toggle",
        id,
        group: id,
        summary: summarize(group),
        entries: group,
        expanded,
        failed: failed(group[group.length - 1]),
      });
      if (expanded) entryRows(group, out);
    }
    group = [];
  };
  for (const item of items) {
    if (item.kind === "text") {
      flush();
      out.push({
        kind: "assistant",
        id: item.id,
        text: item.text,
        streaming: false,
        meta: null,
      });
    } else group.push(item);
  }
  flush();
}

function entryRows(entries: Entry[], out: Row[]) {
  for (const entry of entries)
    out.push({ kind: "work", id: `${entry.id}x`, entry, inGroup: true });
}

function foldLabel(turn: Turn): string {
  const body = turn.result?.body ?? {};
  const ms =
    typeof body.ms === "number"
      ? body.ms
      : turn.result
        ? Date.parse(turn.result.at) - Date.parse(turn.start.at)
        : null;
  const took = ms !== null && Number.isFinite(ms) ? duration(ms) : null;
  if (body.stopReason === "cancelled")
    return took ? `You stopped after ${took}` : "You stopped this response";
  return took ? `Worked for ${took}` : "Worked";
}

export function failed(entry: Entry): boolean {
  return (
    (entry.kind === "tool" && entry.tool.status === "failed") ||
    (entry.kind === "task" && entry.task.state === "failed")
  );
}

// What a group of doings comes to: "Read 3 files and ran 2 commands".
function summarize(entries: Entry[]): string {
  const counts = new Map<string, number>();
  const changed = new Set<string>();
  for (const e of entries) {
    const action = actionOf(e);
    if (action === "edit" && e.kind === "tool") {
      const paths = e.tool.locations?.map((l) => l.path) ?? [];
      if (paths.length) {
        paths.forEach((p) => changed.add(p));
        continue;
      }
    }
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  if (changed.size)
    counts.set("edit", (counts.get("edit") ?? 0) + changed.size);
  const labels = [...counts].map(([action, n]) => actionLabel(action, n));
  const parts = labels.map((l, i) =>
    i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1),
  );
  if (parts.length < 2) return parts[0] ?? "";
  if (parts.length === 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function actionOf(e: Entry): string {
  if (e.kind === "thought") return "thought";
  if (e.kind === "task") return "task";
  if (e.tool.agent) return "agent";
  if (e.tool.workflow) return "task";
  switch (e.tool.kind) {
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "execute":
      return "command";
    case "search":
      return "code-search";
    case "fetch":
      return "search";
    default:
      return "other";
  }
}

function actionLabel(action: string, n: number): string {
  const s = (one: string, many: string) => (n === 1 ? one : many);
  switch (action) {
    case "read":
      return `Read ${n} ${s("file", "files")}`;
    case "edit":
      return `Changed ${n} ${s("file", "files")}`;
    case "command":
      return `Ran ${n} ${s("command", "commands")}`;
    case "search":
      return `Searched the web ${n} ${s("time", "times")}`;
    case "code-search":
      return `Searched code ${n} ${s("time", "times")}`;
    case "thought":
      return `Thought ${n} ${s("time", "times")}`;
    case "agent":
      return `Ran ${n} ${s("subagent", "subagents")}`;
    case "task":
      return `Ran ${n} ${s("task", "tasks")}`;
    default:
      return `Used ${n} ${s("tool", "tools")}`;
  }
}

// What a row says about a doing: the command it ran, the subagent's task,
// or its title with the path it touched.
export function labelOf(entry: Entry): string {
  if (entry.kind === "thought") return entry.text.split("\n")[0] || "Thought";
  if (entry.kind === "task")
    return entry.task.name ?? entry.task.description ?? "Task";
  const { tool } = entry;
  if (tool.agent) return tool.title === "Task" ? "Subagent" : tool.title;
  if (tool.workflow) return `Workflow ${tool.workflow.name}`;
  const command = commandOf(tool);
  if (tool.kind === "execute" && command) return command;
  const chip = chipOf(tool);
  if (chip && !tool.title.includes(chip.split("/").pop() ?? chip))
    return `${tool.title} ${chip}`;
  return tool.title;
}

// Beside a doing's label, in fewer words: a subagent's kind and bill, a
// task's state.
export function metaOf(entry: Entry): string | null {
  if (entry.kind === "task") {
    const { state, summary } = entry.task;
    return summary ? `${stateWord(state)} · ${summary}` : stateWord(state);
  }
  if (entry.kind !== "tool" || !entry.tool.agent) return null;
  const { tool } = entry;
  const parts: string[] = [];
  if (tool.agentType) parts.push(tool.agentType);
  if (tool.usage) {
    parts.push(`${compact(tool.usage.tokens)} tokens`);
    if (tool.usage.toolUses)
      parts.push(
        `${tool.usage.toolUses} ${tool.usage.toolUses === 1 ? "tool" : "tools"}`,
      );
    if (tool.usage.ms) parts.push(duration(tool.usage.ms));
  } else if (tool.status && tool.status !== "completed")
    parts.push(stateWord(tool.status));
  return parts.length ? parts.join(" · ") : null;
}

export function stateWord(state: string): string {
  switch (state) {
    case "running":
    case "pending":
    case "in_progress":
      return "Working";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
    case "cancelled":
      return "Stopped";
    default:
      return state.charAt(0).toUpperCase() + state.slice(1);
  }
}

export const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

// While the agent works: what it is running, how many subagents are out.
function liveLabel(tools: ToolState[], tasks: TaskState[] = []): string {
  const agents = tools.filter((t) => t.agent);
  if (agents.length)
    return `${agents.length} ${agents.length === 1 ? "subagent" : "subagents"} working`;
  const running = tasks.filter((t) => t.state === "running").length;
  if (tools.length === 0 && running)
    return `${running} ${running === 1 ? "task" : "tasks"} running`;
  const tool = tools.at(-1);
  if (!tool) return "Working";
  const command = commandOf(tool);
  if (tool.kind === "execute" && command)
    return `Running ${command.split(/\s+/)[0] || "command"}`;
  return labelOf({ id: "", kind: "tool", at: "", tool, children: [] });
}

function commandOf(tool: ToolState): string | null {
  const input = tool.rawInput as Record<string, unknown> | undefined;
  const c = input?.command;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

// The one thing a tool touched: the path, the pattern, the URL.
function chipOf(t: ToolState): string | null {
  const loc = t.locations?.[0]?.path;
  if (loc) return loc;
  const input = t.rawInput as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return null;
  for (const k of [
    "file_path",
    "path",
    "pattern",
    "url",
    "query",
    "description",
  ]) {
    const v = input[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

// What opens under a row: the whole thought, a subagent's brief and report,
// or what the tool produced.
export function detailOf(entry: Entry): string | null {
  if (entry.kind === "thought")
    return entry.text.includes("\n") ? entry.text : null;
  if (entry.kind === "task") return entry.task.summary ?? null;
  const { tool } = entry;
  const parts: string[] = [];
  const input = tool.rawInput as Record<string, unknown> | undefined;
  if (tool.agent && typeof input?.prompt === "string") parts.push(input.prompt);
  const command = commandOf(tool);
  if (command && command !== labelOf(entry)) parts.push(command);
  for (const c of (tool.content ?? []) as Record<string, any>[]) {
    if (c.type === "content" && c.content?.type === "text")
      parts.push(c.content.text);
    else if (c.type === "diff")
      parts.push(
        `${c.path}\n${
          c.oldText != null
            ? c.oldText
                .split("\n")
                .map((l: string) => `- ${l}`)
                .join("\n") + "\n"
            : ""
        }${String(c.newText ?? "")
          .split("\n")
          .map((l: string) => `+ ${l}`)
          .join("\n")}`,
      );
  }
  const text = parts.join("\n\n").trim();
  return text ? text.slice(0, 20000) : null;
}

// How long something took, as t3code says it: 4s, 2m 10s, 1h 5m.
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

// When something happened: the time today, the day and time otherwise.
export function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
