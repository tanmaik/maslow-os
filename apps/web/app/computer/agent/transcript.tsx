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

import type {
  PlanEntry,
  ToolCall,
  ToolKind,
  ToolStatus,
} from "@/app/computer/agent/acp";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
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

export const titleOf = (call: ToolCall) =>
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

// What the agent is thinking, shown as it comes: the comet and the
// words under it while they arrive, and once they have, one line that
// opens onto them again, with how long it took.
export function Thought({
  text,
  live = false,
}: {
  text: string;
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [took, setTook] = useState(0);
  const from = useRef(Date.now());
  // How long the thinking took, read once the words have stopped coming.
  // A thought that arrived whole took no time here, and the line below
  // shows no clock for it.
  useEffect(() => {
    if (!live) setTook((Date.now() - from.current) / 1000);
  }, [live]);
  if (live)
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <AgentThinking variant="infinity" label="Thinking" />
        {text && (
          <Markdown className="border-s-2 border-separator-border ps-3 text-text-tertiary">
            {text}
          </Markdown>
        )}
      </div>
    );
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="py-1">
      <CollapsibleTrigger className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-caption-1-medium text-text-tertiary transition-colors duration-fast ease-plain outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring sm:min-h-0">
        Thought
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
    <div className="py-1">
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
                "text-body-regular",
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
