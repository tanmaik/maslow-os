"use client";

import { Bot, Waypoints } from "lucide-react";

import {
  compact,
  duration,
  stateWord,
  when,
  type AgentEvent,
  type TaskState,
  type ToolState,
} from "@/components/agent/timeline";
import { cn } from "@/lib/utils";

// The fleet, as t3code's Agents panel lists it: every subagent this
// conversation has spawned and every task it has started, newest first,
// each with its state, its kind, and what it cost. Live ones lead.
export function AgentsPanel({
  events,
  tools,
  tasks,
}: {
  events: AgentEvent[];
  tools: ToolState[];
  tasks: TaskState[];
}) {
  const settled = events.filter(
    (e) => e.kind === "tool" && (e.body as { agent?: boolean }).agent,
  );
  const live = tools.filter((t) => t.agent);
  const settledTasks = new Map<string, { task: TaskState; at: string }>();
  for (const e of events)
    if (e.kind === "task") {
      const task = e.body as unknown as TaskState;
      settledTasks.set(task.id, { task, at: e.at });
    }
  for (const task of tasks) settledTasks.set(task.id, { task, at: "" });
  const empty = live.length + settled.length + settledTasks.size === 0;
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      role="tabpanel"
      data-agents-panel
    >
      {empty && (
        <p className="text-muted-foreground px-2 py-6 text-center text-xs text-pretty">
          No subagents or tasks yet. The agent spawns them when a job splits.
        </p>
      )}
      <ul className="flex flex-col gap-px">
        {live.map((tool) => (
          <AgentRow key={tool.toolCallId} tool={tool} at={null} />
        ))}
        {[...settled].reverse().map((e) => (
          <AgentRow
            key={e.seq}
            tool={e.body as unknown as ToolState}
            at={e.at}
          />
        ))}
        {[...settledTasks.values()].reverse().map(({ task, at }) => (
          <li
            key={task.id}
            className="flex items-start gap-2.5 rounded-md px-2 py-2"
            data-task={task.state}
          >
            <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center">
              <Waypoints className="size-4 stroke-[1.8]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {task.name ?? task.description ?? "Task"}
              </p>
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Dot state={task.state} />
                {stateWord(task.state)}
                {task.taskType && ` · ${task.taskType}`}
                {at && ` · ${when(at)}`}
              </p>
              {task.summary && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {task.summary}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentRow({ tool, at }: { tool: ToolState; at: string | null }) {
  const state = tool.status ?? "pending";
  const input = tool.rawInput as { prompt?: unknown } | undefined;
  return (
    <li
      className="flex items-start gap-2.5 rounded-md px-2 py-2"
      data-agent={state}
    >
      <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center">
        <Bot className="size-4 stroke-[1.8]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {tool.title === "Task" ? "Subagent" : tool.title}
        </p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums">
          <Dot state={state} />
          {stateWord(state)}
          {tool.agentType && ` · ${tool.agentType}`}
          {tool.usage && ` · ${compact(tool.usage.tokens)} tokens`}
          {tool.usage?.ms ? ` · ${duration(tool.usage.ms)}` : ""}
          {at && ` · ${when(at)}`}
        </p>
        {state !== "completed" && tool.activity ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {tool.activity.split("\n").filter(Boolean).at(-1)}
          </p>
        ) : typeof input?.prompt === "string" ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {input.prompt}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// A settled state is a colour; work in progress is the same blue as the
// sidebar's Working.
function Dot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "completed"
          ? "bg-emerald-700 dark:bg-emerald-300"
          : state === "failed"
            ? "bg-destructive"
            : state === "stopped" || state === "cancelled"
              ? "bg-muted-foreground"
              : "bg-sky-700 dark:bg-sky-400",
      )}
    />
  );
}
