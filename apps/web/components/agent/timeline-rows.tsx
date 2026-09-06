"use client";

import {
  AlarmClock,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Globe,
  Search,
  SquarePen,
  Terminal,
  Waypoints,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  detailOf,
  duration,
  failed,
  labelOf,
  metaOf,
  when,
  type Entry,
  type Row,
  type ToolState,
} from "@/components/agent/timeline";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";

// One row of the thread, rendered by kind, spaced as t3code spaces them.
export function TimelineRow({
  row,
  onToggleTurn,
  onToggleGroup,
}: {
  row: Row;
  onToggleTurn: (turn: number) => void;
  onToggleGroup: (group: string) => void;
}) {
  const inGroup = row.kind === "work" && row.inGroup;
  const groupHeader =
    (row.kind === "work-toggle" || row.kind === "work-live") && row.expanded;
  return (
    <div
      className={cn(
        inGroup
          ? "pb-0"
          : groupHeader
            ? "pb-0"
            : row.kind === "fold" || row.kind === "working"
              ? "pb-1.5"
              : (row.kind === "assistant" && row.meta === null) ||
                  row.kind === "work" ||
                  row.kind === "work-live" ||
                  row.kind === "work-toggle" ||
                  row.kind === "thinking"
                ? "pb-2"
                : "pb-4",
        (row.kind === "assistant" || row.kind === "assistant-meta") &&
          "group/assistant",
      )}
      data-row-kind={row.kind}
    >
      {row.kind === "user" && <UserRow text={row.text} />}
      {row.kind === "wake" && (
        <div
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-1 text-sm leading-relaxed"
          title={row.prompt || undefined}
          data-wake
        >
          <AlarmClock aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {row.reason ? `Woke up: ${row.reason}` : "Woke up on its own"}
          </span>
        </div>
      )}
      {row.kind === "assistant" && (
        <AssistantRow
          text={row.text}
          streaming={row.streaming}
          meta={row.meta}
        />
      )}
      {row.kind === "assistant-meta" && (
        <div className="px-1">
          <AssistantMeta
            className="mt-0.5"
            at={row.at}
            text={row.text}
            always
          />
        </div>
      )}
      {row.kind === "fold" && (
        <div className="border-border/60 border-b pt-1 pb-2">
          <button
            type="button"
            aria-expanded={row.expanded}
            onClick={() => onToggleTurn(row.turn)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 flex cursor-pointer items-center gap-1 rounded-md px-1 text-sm leading-relaxed tabular-nums transition-colors select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
          >
            <span>{row.label}</span>
            {row.expanded ? (
              <ChevronDown aria-hidden className="size-3.5" />
            ) : (
              <ChevronRight aria-hidden className="size-3.5" />
            )}
          </button>
        </div>
      )}
      {row.kind === "working" && (
        <div className="border-border/60 border-b pt-1 pb-2">
          <div className="text-muted-foreground flex h-6 min-w-0 items-baseline px-1 text-sm leading-relaxed tabular-nums">
            <span className="relative shrink-0 overflow-hidden whitespace-nowrap">
              Working for <WorkingTimer since={row.since} />
            </span>
          </div>
        </div>
      )}
      {row.kind === "thinking" && (
        <div className="min-h-7">
          <Activity label="Thinking" icon={Brain} active />
        </div>
      )}
      {row.kind === "work-live" && (
        <button
          type="button"
          className="focus-visible:ring-ring/70 flex min-h-6 w-full max-w-full cursor-pointer items-center rounded-md text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
          aria-expanded={row.expanded}
          onClick={() => onToggleGroup(row.group)}
        >
          <Activity
            label={row.label}
            icon={row.tool ? iconOf(row.tool) : Wrench}
            failed={row.tool?.status === "failed"}
            active
          />
        </button>
      )}
      {row.kind === "work-toggle" && (
        <button
          type="button"
          className="group/tool-group hover:bg-accent/20 focus-visible:ring-ring/70 flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-sm leading-relaxed transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
          aria-label={
            row.failed ? `${row.summary}, tool call failed` : undefined
          }
          aria-expanded={row.expanded}
          onClick={() => onToggleGroup(row.group)}
        >
          <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center">
            <Wrench aria-hidden className="size-4 shrink-0 stroke-[1.8]" />
          </span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {row.summary}
          </span>
        </button>
      )}
      {row.kind === "work" && (
        <WorkRow entry={row.entry} inGroup={row.inGroup} />
      )}
      {row.kind === "restart" && (
        <p className="text-muted-foreground border-t pt-2 text-xs" data-restart>
          The machine restarted while the agent was working.
        </p>
      )}
    </div>
  );
}

function UserRow({ text }: { text: string }) {
  return (
    <Message align="end">
      <MessageContent className="items-end">
        <div className="bg-muted text-foreground relative max-w-[80%] rounded-2xl p-3 text-sm leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text}
        </div>
      </MessageContent>
    </Message>
  );
}

function AssistantRow({
  text,
  streaming,
  meta,
}: {
  text: string;
  streaming: boolean;
  meta: string | null;
}) {
  return (
    <div className="relative min-w-0 px-1 py-0.5">
      <Markdown className="max-w-none">
        {text || (streaming ? "" : "The agent said nothing.")}
      </Markdown>
      {meta !== null && (
        <AssistantMeta className="mt-1.5" at={meta} text={text} />
      )}
    </div>
  );
}

// Under the turn's last word: a copy button and when it was said, shown on
// hover unless the row stands alone.
function AssistantMeta({
  at,
  text,
  className,
  always = false,
}: {
  at: string;
  text: string;
  className?: string;
  always?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs tabular-nums transition-opacity duration-150",
        always
          ? "opacity-100"
          : "opacity-0 group-hover/assistant:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        aria-label={copied ? "Copied" : "Copy message"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            return;
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <p
        className="text-muted-foreground text-xs tabular-nums"
        title={new Date(at).toLocaleString()}
        suppressHydrationWarning
      >
        {when(at)}
      </p>
    </div>
  );
}

// A doing in progress, its label shining while it runs.
function Activity({
  label,
  icon: Icon,
  failed = false,
  active = false,
}: {
  label: string;
  icon: typeof Wrench;
  failed?: boolean;
  active?: boolean;
}) {
  return (
    <div className="min-h-6 w-fit max-w-full min-w-0 overflow-hidden rounded-md text-sm leading-relaxed">
      <span className="text-muted-foreground flex min-h-6 min-w-0 items-center gap-1.5 px-0.5 py-0.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <Icon className="block size-4 shrink-0 stroke-[1.8]" />
        </span>
        <span
          className={cn("min-w-0 flex-1 truncate", active && "live-tool-shine")}
        >
          {label}
        </span>
        {failed && (
          <X aria-hidden className="text-destructive size-3 shrink-0" />
        )}
      </span>
    </div>
  );
}

// One doing, settled: what it was, on what, and, opened, what came of it.
function WorkRow({ entry, inGroup }: { entry: Entry; inGroup: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const label = labelOf(entry);
  const meta = metaOf(entry);
  const children = entry.kind === "tool" ? entry.children : [];
  const detail = detailOf(entry);
  const opens = Boolean(detail) || children.length > 0;
  const bad = failed(entry);
  const Icon =
    entry.kind === "thought"
      ? Brain
      : entry.kind === "task"
        ? Waypoints
        : iconOf(entry.tool);
  const running =
    entry.kind === "tool" &&
    entry.tool.agent &&
    entry.tool.status !== "completed" &&
    entry.tool.status !== "failed";
  const toggle = () => opens && setExpanded((e) => !e);
  return (
    <div
      className={cn(
        "flex flex-col rounded-md px-0.5 transition-colors",
        inGroup ? "py-0" : "py-0.5",
        opens &&
          "hover:bg-accent/20 focus-visible:ring-ring/70 cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none",
      )}
      role={opens ? "button" : undefined}
      tabIndex={opens ? 0 : undefined}
      aria-expanded={opens ? expanded : undefined}
      aria-label={bad ? `${label}, tool call failed` : undefined}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      }}
      data-tool={
        entry.kind === "tool" ? (entry.tool.status ?? "pending") : undefined
      }
      data-agent={entry.kind === "tool" && entry.tool.agent ? "" : undefined}
      data-task={entry.kind === "task" ? entry.task.state : undefined}
    >
      <div className="flex items-center gap-1.5 select-none">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            bad ? "text-destructive" : "text-muted-foreground",
          )}
          role={bad ? "img" : undefined}
          aria-label={bad ? "Tool call failed" : undefined}
        >
          <Icon className="block size-4 shrink-0 stroke-[1.8]" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="flex w-full min-w-0 items-baseline gap-1.5 text-sm leading-relaxed">
            <span
              className={cn(
                "min-w-0 flex-1",
                expanded
                  ? "break-words whitespace-pre-wrap select-text"
                  : "truncate",
                bad
                  ? "text-destructive font-medium"
                  : entry.kind === "thought"
                    ? "text-foreground/80"
                    : "text-muted-foreground",
              )}
              onClick={expanded ? (e) => e.stopPropagation() : undefined}
            >
              {label}
            </span>
            {meta && (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {meta}
              </span>
            )}
          </p>
          {bad && (
            <X aria-hidden className="text-destructive size-3 shrink-0" />
          )}
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              !opens && "invisible",
            )}
            aria-hidden
          >
            <ChevronDown
              className={cn(
                "text-muted-foreground size-3 shrink-0 opacity-70 transition-transform duration-200",
                expanded && "rotate-180",
              )}
            />
          </span>
        </div>
      </div>
      {running && entry.kind === "tool" && entry.tool.activity && (
        <p className="text-muted-foreground ms-7 truncate text-xs leading-relaxed">
          {entry.tool.activity.split("\n").filter(Boolean).at(-1)}
        </p>
      )}
      {expanded && children.length > 0 && (
        <div
          className="border-border/60 mt-1 ms-3 flex flex-col border-s ps-1"
          onClick={(e) => e.stopPropagation()}
        >
          {children.map((child) => (
            <WorkRow key={child.id} entry={child} inGroup />
          ))}
        </div>
      )}
      {expanded && detail && (
        <div
          className="bg-muted/40 mt-1 ms-7 cursor-default rounded-md px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <pre className="text-muted-foreground max-h-64 cursor-text overflow-auto font-mono text-[0.6875rem] leading-relaxed break-words whitespace-pre-wrap select-text">
            {detail}
          </pre>
        </div>
      )}
    </div>
  );
}

// Ticks its own text so a running clock does not re-render the thread.
function WorkingTimer({ since }: { since: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current)
        ref.current.textContent = duration(Date.now() - Date.parse(since));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  return (
    <span ref={ref} className="tabular-nums">
      {duration(Math.max(0, Date.now() - Date.parse(since)))}
    </span>
  );
}

function iconOf(tool: ToolState): typeof Wrench {
  if (tool.agent) return Bot;
  if (tool.workflow) return Waypoints;
  switch (tool.kind) {
    case "read":
      return Eye;
    case "edit":
    case "delete":
    case "move":
      return SquarePen;
    case "search":
      return Search;
    case "execute":
      return Terminal;
    case "think":
      return Brain;
    case "fetch":
      return Globe;
    default:
      return Wrench;
  }
}
