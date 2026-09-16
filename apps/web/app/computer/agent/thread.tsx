"use client";

import {
  RiArrowDownSLine,
  RiEditLine,
  RiFileTextLine,
  RiGlobalLine,
  RiTerminalBoxLine,
  RiToolsLine,
} from "@remixicon/react";
import { useEffect, useRef, useState } from "react";

import type {
  Item,
  PermissionOption,
  Terminal,
  ToolCall,
  ToolKind,
} from "@/app/computer/agent/acp";
import { type Ask, type Chat, useChats } from "@/app/computer/agent/chats";
import {
  markFor,
  Plan,
  Thought,
  titleOf,
} from "@/app/computer/agent/transcript";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import {
  AssistantMessage,
  Line as Said,
  UserMessage,
} from "@/components/application/ai-chat/ai-chat-container";
import { Questionnaire } from "@/components/application/questionnaire/questionnaire";
import { Notification } from "@/components/base/notification/notification";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Markdown } from "@/components/markdown";
import {
  TaskList,
  type TaskListStep,
  type TaskListTask,
} from "@/components/application/task-list/task-list";
import {
  WebSearch,
  type WebSearchStep,
} from "@/components/application/web-search/web-search";

// The steps between one thing said and the next, as BoardUI's two logs
// draw them: where the agent went, for a run of searches and pages
// opened, and what it did, for everything else. Each stretch of the same
// kind is one block, in the order the work came.

// Whether a step is a search or a page opened, which the research log
// draws, or work of any other kind, which the task list draws.
const went = (call: ToolCall) =>
  call.toolName === "WebSearch" ||
  call.toolName === "WebFetch" ||
  (call.kind === "search" && /web|search/i.test(call.title)) ||
  call.kind === "fetch";

// A path in a step's title, which becomes a chip beside the words.
const PATH = /(?:^|\s)((?:\/|~\/|\.\/)?[\w.-]+(?:\/[\w.-]+)+|\/[\w.-]+)/g;

// The words of a step and the files it names, apart; a step that failed,
// or a command that did not end well, says so in its line.
function stepOf(
  call: ToolCall,
  terminal: Terminal | undefined,
  onShow: (call: ToolCall) => void,
): TaskListStep {
  const title = titleOf(call);
  const paths = [...title.matchAll(PATH)].map((m) => m[1]!);
  const exit = terminal?.exitStatus;
  const how =
    call.status === "failed"
      ? " (failed)"
      : exit?.signal
        ? " (stopped)"
        : exit && exit.exitCode !== 0 && exit.exitCode !== null
          ? ` (exit ${exit.exitCode})`
          : "";
  const label =
    (paths.length
      ? title.replace(PATH, " ").replace(/\s+/g, " ").trim()
      : title) + how;
  return {
    label: label || title,
    chips: paths.map((p) => ({ label: p.split("/").filter(Boolean).at(-1)! })),
    ...(more(call, terminal) ? { onClick: () => onShow(call) } : {}),
  };
}

// What a stretch of work did, said once it is done: counted by kind.
function summaryOf(calls: ToolCall[]): string {
  const n = (k: (c: ToolCall) => boolean) => calls.filter(k).length;
  const parts = [
    [n((c) => c.kind === "read"), "read", "file", "files"],
    [
      n((c) => c.kind === "edit" || c.kind === "delete" || c.kind === "move"),
      "changed",
      "file",
      "files",
    ],
    [n((c) => c.kind === "execute"), "ran", "command", "commands"],
    [n((c) => c.toolName === "Task"), "sent", "subagent", "subagents"],
  ] as const;
  const said = parts
    .filter(([count]) => count > 0)
    .map(
      ([count, verb, one, many]) =>
        `${verb} ${count} ${count === 1 ? one : many}`,
    );
  const rest = calls.length - parts.reduce((a, [c]) => a + c, 0);
  if (rest > 0) said.push(`${rest} other ${rest === 1 ? "step" : "steps"}`);
  const line = said.join(", ");
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : "Worked";
}

// What it is doing now, from the newest step.
function doingOf(call: ToolCall | undefined): string {
  if (!call) return "Working";
  switch (call.kind) {
    case "read":
      return "Reading";
    case "edit":
    case "delete":
    case "move":
      return "Changing files";
    case "execute":
      return "Running a command";
    case "search":
      return "Searching";
    default:
      return call.toolName === "Task" ? "Working with a subagent" : "Working";
  }
}

// The query a search was for, out of the title Claude Code gives it.
const queryOf = (title: string) =>
  /"([^"]+)"/.exec(title)?.[1] ?? title.replace(/^[^:]*:\s*/, "");

// The page a fetch opened, out of its title.
function pageOf(title: string): { href: string; domain: string } | null {
  const m = /https?:\/\/[^\s)"']+/.exec(title);
  if (!m) return null;
  try {
    return { href: m[0], domain: new URL(m[0]).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function Went({ calls, running }: { calls: ToolCall[]; running: boolean }) {
  const searches = calls.filter(
    (c) => c.toolName !== "WebFetch" && c.kind !== "fetch",
  ).length;
  const steps: WebSearchStep[] = [
    {
      label: running
        ? "Looking things up"
        : searches > 0
          ? `Ran ${searches} ${searches === 1 ? "search" : "searches"}`
          : `Read ${calls.length} ${calls.length === 1 ? "page" : "pages"}`,
      icon: RiGlobalLine,
      heading: true,
    },
    ...calls.map((c): WebSearchStep => {
      const page = pageOf(c.title);
      if (c.toolName === "WebFetch" || (c.kind === "fetch" && page))
        return {
          label: c.status === "failed" ? "Could not open" : "Opened",
          query: page?.domain ?? c.title,
          icon: RiGlobalLine,
          sources: page
            ? [{ title: page.domain, domain: page.domain, href: page.href }]
            : undefined,
        };
      return {
        label: c.status === "failed" ? "Search failed for" : "Searched for",
        query: queryOf(c.title),
        icon: RiGlobalLine,
      };
    }),
  ];
  return <WebSearch steps={steps} revealed={steps.length} working={false} />;
}

function Did({
  calls,
  running,
  under,
  terminalOf,
  onShow,
}: {
  calls: ToolCall[];
  running: boolean;
  under: (toolCallId: string) => ToolCall[];
  terminalOf: (call: ToolCall) => Terminal | undefined;
  onShow: (call: ToolCall) => void;
}) {
  // A subagent is a task of its own, with the steps it took; the rest of
  // the stretch is one task.
  const tasks: TaskListTask[] = [];
  let plain: ToolCall[] = [];
  const flush = () => {
    if (plain.length === 0) return;
    const last = plain.at(-1)!;
    tasks.push({
      title: summaryOf(plain),
      runningTitle: doingOf(last),
      icon: markFor(last.kind, last.toolName),
      steps: plain.map((c) => stepOf(c, terminalOf(c), onShow)),
    });
    plain = [];
  };
  for (const c of calls) {
    if (c.toolName !== "Task") {
      plain.push(c);
      continue;
    }
    flush();
    const steps = under(c.toolCallId);
    tasks.push({
      title: `A subagent: ${summaryOf(steps).toLowerCase()}`,
      runningTitle: "A subagent is working",
      icon: markFor(c.kind, c.toolName),
      steps: steps.length
        ? steps.map((s) => stepOf(s, terminalOf(s), onShow))
        : [{ label: c.title }],
    });
  }
  flush();
  const units = tasks.reduce((n, t) => n + 1 + t.steps.length, 0);
  return (
    <TaskList
      tasks={tasks}
      revealed={units}
      working={running ? doingOf(calls.at(-1)) : false}
      // Open while the agent is at it, folded to its one line once it has
      // moved on; a click opens it again.
      collapseOnComplete={running ? false : "all"}
    />
  );
}

// A run of steps, split where the kind of work changes.
function Steps({
  calls,
  running,
  under,
  terminalOf,
  onShow,
}: {
  calls: ToolCall[];
  /** Whether the agent is still at this run. */
  running: boolean;
  under: (toolCallId: string) => ToolCall[];
  terminalOf: (call: ToolCall) => Terminal | undefined;
  onShow: (call: ToolCall) => void;
}) {
  const stretches: { went: boolean; calls: ToolCall[] }[] = [];
  for (const c of calls) {
    const last = stretches.at(-1);
    if (last && last.went === went(c)) last.calls.push(c);
    else stretches.push({ went: went(c), calls: [c] });
  }
  return (
    <div className="flex flex-col gap-2">
      {stretches.map((s, i) =>
        s.went ? (
          <Went
            key={s.calls[0]!.toolCallId}
            calls={s.calls}
            running={running && i === stretches.length - 1}
          />
        ) : (
          <Did
            key={s.calls[0]!.toolCallId}
            calls={s.calls}
            running={running && i === stretches.length - 1}
            under={under}
            terminalOf={terminalOf}
            onShow={onShow}
          />
        ),
      )}
    </div>
  );
}

// What the agent did between one thing said and the next, as one fold:
// its pieces one under another while it is at it, the newest live, and
// one line saying what was done once it has moved on, which a click opens
// onto the pieces again, each folded in its own right.
type Piece = Exclude<Item, { kind: "said" | "tool" }> | ToolCall[];
function Log({
  pieces,
  live,
  under,
  terminalOf,
  onShow,
}: {
  pieces: Piece[];
  /** Whether the agent is still at this stretch. */
  live: boolean;
  under: (toolCallId: string) => ToolCall[];
  terminalOf: (call: ToolCall) => Terminal | undefined;
  onShow: (call: ToolCall) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = live || open;
  const calls = pieces.flatMap((p) => (Array.isArray(p) ? p : []));
  const thoughts = pieces.filter(
    (p) => !Array.isArray(p) && p.kind === "thought",
  ).length;
  const did = [
    thoughts > 0 && `thought ${thoughts} ${thoughts === 1 ? "time" : "times"}`,
    calls.length > 0 && summaryOf(calls).toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="flex flex-col gap-1">
      {!live && (
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 cursor-pointer items-center gap-1 rounded-md text-body-2-medium text-text-tertiary transition-colors duration-fast ease-plain outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring sm:min-h-0"
        >
          {did ? did.charAt(0).toUpperCase() + did.slice(1) : "Worked"}
          <RiArrowDownSLine
            className={`size-4 transition-transform duration-fast ${shown ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      )}
      {shown &&
        pieces.map((piece, i) => {
          const now = live && i === pieces.length - 1;
          return Array.isArray(piece) ? (
            <Steps
              key={piece[0]!.toolCallId}
              calls={piece}
              running={now}
              under={under}
              terminalOf={terminalOf}
              onShow={onShow}
            />
          ) : piece.kind === "thought" ? (
            <Thought key={piece.id} text={piece.text} live={now} />
          ) : (
            <Plan key={piece.id} entries={piece.entries} />
          );
        })}
    </div>
  );
}

// What the agent asks before it acts: one line saying what kind of thing,
// the thing itself as it would run, and the answers as buttons in the
// order a hand weighs them. BoardUI's notification, standing in the
// thread where the work paused.
const ASK_MARK: Record<ToolKind, typeof RiToolsLine> = {
  read: RiFileTextLine,
  edit: RiEditLine,
  delete: RiEditLine,
  move: RiEditLine,
  search: RiFileTextLine,
  execute: RiTerminalBoxLine,
  think: RiToolsLine,
  fetch: RiGlobalLine,
  switch_mode: RiToolsLine,
  other: RiToolsLine,
};
const ASK_SAID: Record<ToolKind, string> = {
  read: "Read a file?",
  edit: "Change a file?",
  delete: "Delete a file?",
  move: "Move a file?",
  search: "Search the files?",
  execute: "Run this command?",
  think: "Go on?",
  fetch: "Fetch a page?",
  switch_mode: "Change how it acts?",
  other: "Use this tool?",
};
const ANSWER: Record<PermissionOption["kind"], string> = {
  allow_once: "Allow",
  allow_always: "Always",
  reject_once: "No",
  reject_always: "Never",
};
function Asked({
  ask,
  onAnswer,
}: {
  ask: Ask;
  onAnswer: (result: unknown) => void;
}) {
  // A questionnaire: each question a step, the answers by question as
  // Claude Code's tool takes them, the labels picked joined by commas.
  const qs = ask.questions;
  if (qs?.length)
    return (
      <Questionnaire
        className="shadow-none"
        questions={qs.map((q, i) => ({
          id: String(i),
          question: q.question,
          stepLabel: q.header,
          select: q.multiSelect ? "multiple" : "single",
          options: q.options.map((o) => ({
            value: o.label,
            label: o.label,
            description: o.description,
          })),
          other: true,
        }))}
        onComplete={(a) =>
          onAnswer({
            answers: Object.fromEntries(
              qs.map((q, i) => {
                const said = a[String(i)];
                return [
                  q.question,
                  [
                    ...(said?.values ?? []),
                    ...(said?.other ? [said.other] : []),
                  ].join(", "),
                ];
              }),
            ),
          })
        }
      />
    );
  // The thing itself, without the backticks Claude Code wraps a command in.
  const what = ask.title.replace(/^`+|`+$/g, "").trim();
  return (
    <Notification
      status="neutral"
      icon={ASK_MARK[ask.kind] ?? RiToolsLine}
      title={ASK_SAID[ask.kind] ?? ASK_SAID.other}
      description={
        <span className="line-clamp-3 font-mono text-[12px] leading-5 break-all">
          {what}
        </span>
      }
      dismissible={false}
      className="shadow-none"
      actions={ask.options.map((o) => ({
        label: ANSWER[o.kind] ?? o.name,
        variant: o.kind === "allow_once" ? "primary" : "secondary",
        onClick: () =>
          onAnswer({ outcome: { outcome: "selected", optionId: o.optionId } }),
      }))}
    />
  );
}

// The conversation as it reads: what was said, each on its own, and the
// steps between one thing said and the next as one stretch, the comet
// where words are still to come, and what the agent asks before it acts.
// The Agent window's one thread, which follows its newest line.
export function Thread({
  chat,
  onAnswer,
  onStop,
}: {
  chat: Chat;
  onAnswer: (a: Ask, result: unknown) => void;
  onStop: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  // A step opened onto what it did: the command's output, the edit.
  const [showing, setShowing] = useState<ToolCall | null>(null);
  const { wrote } = useChats();
  const { items, asks, running } = chat;
  // How much this conversation's own terminals have written, so output in
  // another one never pulls this thread to its foot.
  const shown = items
    .flatMap((i) => (i.kind === "tool" ? i.call.content : []))
    .flatMap((c) =>
      c.type === "terminal" ? [wrote[c.terminalId]?.output.length ?? 0] : [],
    )
    .join();
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, asks, running, shown]);

  // The steps a subagent took, in the order they came.
  const stepsUnder = (toolCallId: string) =>
    items.flatMap((i) =>
      i.kind === "tool" && i.under === toolCallId ? [i.call] : [],
    );
  // The terminal a row's command runs in, where it has one.
  const terminalOf = (call: ToolCall) => {
    const at = call.content.find((c) => c.type === "terminal");
    return at?.type === "terminal" ? wrote[at.terminalId] : undefined;
  };

  type Run =
    | { kind: "said"; item: Extract<Item, { kind: "said" }> }
    | { kind: "log"; items: Exclude<Item, { kind: "said" }>[] };
  const runs = items
    .filter((item) => item.kind !== "tool" || !item.under)
    .reduce<Run[]>((acc, item) => {
      if (item.kind === "said") acc.push({ kind: "said", item });
      else {
        const last = acc.at(-1);
        if (last?.kind === "log") last.items.push(item);
        else acc.push({ kind: "log", items: [item] });
      }
      return acc;
    }, []);
  const lastRun = runs.at(-1);

  // The pieces of a log: thoughts and plans on their own, and the steps
  // between them as one stretch each.
  const piecesOf = (log: Exclude<Item, { kind: "said" }>[]) =>
    log.reduce<Piece[]>((acc, item) => {
      if (item.kind !== "tool") acc.push(item);
      else {
        const last = acc.at(-1);
        if (Array.isArray(last)) last.push(item.call);
        else acc.push([item.call]);
      }
      return acc;
    }, []);

  return (
    <div
      className="min-h-0 w-full flex-1 overflow-y-auto px-4 pt-3 pb-1"
      onKeyDown={(e) => {
        if (e.key === "Escape" && running) {
          e.preventDefault();
          onStop();
        }
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {runs.map((run, r) =>
          run.kind === "said" ? (
            run.item.who === "person" ? (
              <UserMessage key={run.item.id}>{run.item.text}</UserMessage>
            ) : (
              <AssistantMessage
                key={run.item.id}
                text={run.item.text}
                actions={false}
              >
                <Said>
                  <Markdown>{run.item.text}</Markdown>
                </Said>
              </AssistantMessage>
            )
          ) : (
            <Log
              key={run.items[0]!.id}
              pieces={piecesOf(run.items)}
              live={running && r === runs.length - 1}
              under={stepsUnder}
              terminalOf={terminalOf}
              onShow={setShowing}
            />
          ),
        )}
        {running &&
          (!lastRun ||
            (lastRun.kind === "said" && lastRun.item.who === "person")) && (
            <AgentThinking
              variant="infinity"
              label="Thinking"
              className="py-1"
            />
          )}
        {asks.map((a) => (
          <Asked
            key={String(a.askId)}
            ask={a}
            onAnswer={(result) => onAnswer(a, result)}
          />
        ))}
        <div ref={bottom} />
      </div>
      {showing && (
        <Sheet open onOpenChange={(open) => !open && setShowing(null)}>
          <SheetContent
            side="bottom"
            className="max-h-[70dvh] gap-3 rounded-t-3xl p-4"
          >
            <SheetTitle className="truncate text-headline-medium text-text-primary">
              {titleOf(showing).replace(/^`+|`+$/g, "")}
            </SheetTitle>
            <Shown call={showing} terminal={terminalOf(showing)} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

// What a step did, whole: what the command printed, what an edit put in
// a file, what a tool said back.
const more = (call: ToolCall, terminal?: Terminal) =>
  !!terminal?.output ||
  call.content.some(
    (c) =>
      c.type === "diff" || (c.type === "content" && c.content.type === "text"),
  );
function Shown({ call, terminal }: { call: ToolCall; terminal?: Terminal }) {
  const block =
    "overflow-auto rounded-lg bg-background-secondary-default p-3 font-mono text-caption-1-regular whitespace-pre-wrap text-text-secondary";
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {call.content.map((c, i) =>
        c.type === "diff" ? (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-caption-1-medium text-text-tertiary">
              {c.path}
            </span>
            <pre className={block}>{c.newText}</pre>
          </div>
        ) : c.type === "content" && c.content.type === "text" ? (
          <pre key={i} className={block}>
            {c.content.text}
          </pre>
        ) : null,
      )}
      {terminal?.output && <pre className={block}>{terminal.output}</pre>}
    </div>
  );
}
