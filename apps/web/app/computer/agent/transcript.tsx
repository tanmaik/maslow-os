"use client";

import {
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiFileEditLine,
  RiFileTextLine,
  RiGlobalLine,
  RiLightbulbLine,
  RiPaletteLine,
  RiSearchLine,
  RiShuffleLine,
  RiTerminalLine,
} from "@remixicon/react";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useRef, useState } from "react";

import { Highlight } from "prism-react-renderer";

import type {
  PlanEntry,
  Terminal,
  ToolCall,
  ToolKind,
  ToolStatus,
} from "@/app/computer/agent/acp";
import { AI_CHAT_CODE_THEME } from "@/components/application/ai-chat/ai-chat-code-panel";
import { Chip } from "@/components/base/badges/chip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Markdown } from "@/components/markdown";
import { cx } from "@/utils/cx";

// The mark a tool row wears for the kind of work it is.
const MARKS: Record<
  ToolKind,
  ComponentType<Omit<SVGProps<SVGSVGElement>, "children">>
> = {
  read: RiFileTextLine,
  edit: RiFileEditLine,
  delete: RiFileEditLine,
  move: RiShuffleLine,
  search: RiSearchLine,
  execute: RiTerminalLine,
  think: RiLightbulbLine,
  fetch: RiGlobalLine,
  switch_mode: RiShuffleLine,
  other: RiTerminalLine,
};

// What Claude Code's own tools are called where the adapter has no name
// for them: everything else keeps the name it came with.
const PLAIN: Record<string, string> = {
  Task: "A subagent",
  Skill: "Using a skill",
  SlashCommand: "Running a command",
  AskUserQuestion: "Asking you",
  EnterPlanMode: "Planning",
  NotebookEdit: "Editing a notebook",
};

const titleOf = (call: ToolCall) =>
  call.toolName && call.title === call.toolName
    ? (PLAIN[call.toolName] ?? call.title)
    : call.title;

// The servers Claude Code knows on a computer, by the name their tools
// carry: `mcp__<server>__<tool>`.
const SERVERS: Record<
  string,
  ComponentType<Omit<SVGProps<SVGSVGElement>, "children">>
> = {
  brain: RiBrainLine,
  browser: RiGlobalLine,
  boardui: RiPaletteLine,
};

// The mark a piece of work wears: the server it runs on where it is an
// MCP tool, and the kind of work where it is Claude Code's own hand.
export const markFor = (kind: ToolKind, toolName?: string) => {
  const mcp = /^mcp__([^_]+)__/.exec(toolName ?? "");
  return (mcp && SERVERS[mcp[1]!]) ?? MARKS[kind] ?? RiTerminalLine;
};

// Whether the work is still waiting, going, done, or would not go: the
// row's leading mark, and never a spinner inside a spinner.
function Mark({ status }: { status: ToolStatus }) {
  if (status === "completed")
    return (
      <RiCheckLine
        className="size-4 shrink-0 text-foreground-icon-tertiary"
        aria-label="Done"
      />
    );
  if (status === "failed")
    return (
      <RiCloseLine
        className="size-4 shrink-0 text-text-error-primary"
        aria-label="Failed"
      />
    );
  return (
    <span
      role="img"
      aria-label={status === "pending" ? "Waiting" : "Working"}
      className={cx(
        "mx-1 size-2 shrink-0 rounded-full",
        status === "pending"
          ? "border border-border-button-default"
          : "animate-pulse bg-green-500 motion-reduce:animate-none",
      )}
    />
  );
}

// How much of what a tool said belongs in the conversation: enough to see
// what happened, and the rest in the panel beside it.
const LINES = 8;

// What a command wrote, drawn as the panel beside the conversation draws
// it, so a person reads the same thing in either place.
function Wrote({
  text,
  language = "bash",
}: {
  text: string;
  language?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg bg-background-primary-default p-2 font-mono text-[13px] leading-[20px]">
      <Highlight code={text} language={language} theme={AI_CHAT_CODE_THEME}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <code className="block">
            {tokens.map((line, i) => (
              <span key={i} {...getLineProps({ line, className: "block" })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </span>
            ))}
          </code>
        )}
      </Highlight>
    </div>
  );
}

// How a command ended: nothing while it runs, nothing when it ended
// well, and a plain sentence when it did not, with the raw code kept for
// the fold beside it.
function ended(t: Terminal | undefined) {
  const s = t?.exitStatus;
  if (!s) return null;
  if (s.signal)
    return { said: "The command stopped", code: `signal ${s.signal}` };
  if (s.exitCode === 0) return null;
  return { said: "The command did not finish", code: `exit ${s.exitCode}` };
}

// What a tool call changed, as a diff reads: the path, what went and
// what came, one file after another. The one place a change becomes text,
// so the conversation and the panel beside it show the same thing.
const diffOf = (call: ToolCall) =>
  call.content
    .map((d) =>
      d.type !== "diff"
        ? ""
        : [
            `--- ${d.path}`,
            ...(d.oldText ?? "").split("\n").map((l) => `-${l}`),
            ...d.newText.split("\n").map((l) => `+${l}`),
          ].join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");

// What a tool call said as it worked: its content blocks, one after
// another. A terminal of the client's is not among them — Claude Code has
// its own hands on the machine and runs there, not through this page.
const outputOf = (call: ToolCall) =>
  call.content
    .map((c) =>
      c.type === "content" && c.content.type === "text" ? c.content.text : "",
    )
    .join("")
    .trimEnd();

// What a step has to show beside the conversation: what it changed, or
// what it said, under the name of the work.
export function showingOf(
  call: ToolCall,
  terminal?: Terminal,
): { title: string; code: string; language?: string } | null {
  if (terminal?.output)
    return {
      title: call.title,
      language: "bash",
      code: terminal.truncated
        ? `${terminal.output}\n…truncated`
        : terminal.output,
    };
  if (call.content.some((c) => c.type === "diff"))
    return { title: call.title, language: "diff", code: diffOf(call) };
  const said = outputOf(call);
  return said ? { title: call.title, language: "bash", code: said } : null;
}

// One tool call as a row: a line for what it is, what it changed or said
// under a fold, and the same beside the conversation when it is opened.
export function Tool({
  call,
  steps,
  terminal,
  onOpen,
}: {
  call: ToolCall;
  /** The steps a subagent took inside this one, in the order they came. */
  steps?: ToolCall[];
  /** What the command this row ran has written, while it writes it. */
  terminal?: Terminal;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = markFor(call.kind, call.toolName);
  const diffs = call.content.filter((c) => c.type === "diff");
  const said = outputOf(call);
  const subagent = call.toolName === "Task";
  const wrote = terminal?.output ?? "";
  const lines = wrote ? wrote.split("\n") : [];
  const how = ended(terminal);
  const more = diffs.length > 0 || said.length > 0 || subagent || how !== null;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-2lg bg-background-tertiary-default/60 px-3 py-2"
    >
      <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
        <Mark status={call.status} />
        <Icon
          className="size-4 shrink-0 text-foreground-icon-tertiary"
          aria-hidden
        />
        {more && onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 cursor-pointer truncate text-left text-body-2-medium text-text-secondary transition-colors duration-fast ease-plain outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            {titleOf(call)}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-body-2-medium text-text-secondary">
            {titleOf(call)}
          </span>
        )}
        {(call.status === "failed" || how) && (
          <span className="shrink-0 text-caption-1-medium text-text-error-primary">
            {how?.said ?? "Failed"}
          </span>
        )}
        {more && (
          <CollapsibleTrigger className="shrink-0 cursor-pointer rounded-md px-1 py-1 text-caption-1-medium text-text-tertiary transition-colors duration-fast ease-plain outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring">
            {open
              ? "Hide"
              : subagent
                ? `${steps?.length ?? 0} steps`
                : diffs.length
                  ? "Changes"
                  : "Output"}
          </CollapsibleTrigger>
        )}
      </div>
      {wrote && (
        <div className="mt-2 space-y-1">
          <Wrote text={lines.slice(0, LINES).join("\n")} />
          {(lines.length > LINES || terminal?.truncated) && (
            <button
              type="button"
              onClick={onOpen}
              className="cursor-pointer rounded-md text-caption-1-medium text-text-tertiary transition-colors duration-fast ease-plain outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              {terminal?.truncated
                ? "Show what was kept beside the conversation — the rest was truncated"
                : `Show all ${lines.length} lines beside the conversation`}
            </button>
          )}
        </div>
      )}
      {call.status === "failed" && said && (
        <p className="mt-1 truncate text-caption-1-regular text-text-error-primary">
          {said.split("\n").find((l) => l.trim()) ?? ""}
        </p>
      )}
      <CollapsibleContent className="mt-2 space-y-2">
        {how && (
          <p className="font-mono text-caption-1-regular text-text-tertiary">
            {how.code}
          </p>
        )}
        {subagent &&
          (steps?.length ? (
            <div className="space-y-1 border-s-2 border-separator-border ps-3">
              {steps.map((step) => (
                <Tool key={step.toolCallId} call={step} />
              ))}
            </div>
          ) : (
            <p className="text-caption-1-regular text-text-tertiary">
              What a subagent did is not kept: opening this conversation again
              leaves its answer and none of its steps.
            </p>
          ))}
        {diffs.length > 0 && <Wrote text={diffOf(call)} language="diff" />}
        {said && (
          <>
            <pre className="overflow-x-auto rounded-lg bg-background-primary-default p-2 font-mono text-caption-1-regular whitespace-pre-wrap text-text-secondary">
              {said.split("\n").slice(0, LINES).join("\n")}
            </pre>
            {said.split("\n").length > LINES && (
              <button
                type="button"
                onClick={onOpen}
                className="cursor-pointer rounded-md text-caption-1-medium text-text-tertiary transition-colors duration-fast ease-plain outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                Show all {said.split("\n").length} lines beside the conversation
              </button>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// What the agent was thinking, folded away behind one line that opens,
// with how long it took: counted while the words keep coming and stopped
// once they have.
export function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [took, setTook] = useState(0);
  const from = useRef(Date.now());
  // The clock runs while the words keep coming and rests a second after
  // they stop; more words start it again, so a thought that carries on
  // never shows a frozen number.
  useEffect(() => {
    const last = Date.now();
    const tick = setInterval(() => {
      setTook((Date.now() - from.current) / 1000);
      if (Date.now() - last > 1200) clearInterval(tick);
    }, 100);
    return () => clearInterval(tick);
  }, [text]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-body-2-medium text-text-tertiary transition-colors duration-fast ease-plain outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring sm:min-h-0">
        Thinking
        {took > 0.2 && (
          <span className="font-mono text-caption-1-regular tabular-nums">
            {took.toFixed(1)}s
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 border-s-2 border-separator-border ps-3">
        <Markdown className="text-text-tertiary">{text}</Markdown>
      </CollapsibleContent>
    </Collapsible>
  );
}

// What Claude Code means to do next, as a checklist that changes in place.
export function Plan({ entries }: { entries: PlanEntry[] }) {
  const done = entries.filter((e) => e.status === "completed").length;
  return (
    <div className="rounded-2lg bg-background-tertiary-default/60 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-caption-1-medium text-text-tertiary">Plan</span>
        <Chip variant="caption" color="soft">
          {done}/{entries.length}
        </Chip>
      </div>
      <ul className="space-y-1">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1">
              <Mark
                status={
                  e.status === "completed"
                    ? "completed"
                    : e.status === "in_progress"
                      ? "in_progress"
                      : "pending"
                }
              />
            </span>
            <span
              className={cx(
                "text-body-2-regular",
                e.status === "completed"
                  ? "text-text-tertiary line-through"
                  : "text-text-secondary",
              )}
            >
              {e.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
