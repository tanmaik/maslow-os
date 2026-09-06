"use client";

import { Bot, ChevronDown, TerminalSquare, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChatHeader } from "@/components/agent/chat-header";
import { Composer, type ModelOption } from "@/components/agent/composer";
import { AgentsPanel } from "@/components/agent/agents-panel";
import {
  rows,
  type AgentEvent,
  type TaskState,
  type ToolState,
} from "@/components/agent/timeline";
import { TimelineRow } from "@/components/agent/timeline-rows";
import { Terminal } from "@/components/terminal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

export type { AgentEvent, ToolState };

type Frame =
  | { event: AgentEvent }
  | { stream: string }
  | { tool: ToolState }
  | { task: TaskState }
  | {
      snapshot: {
        working: boolean;
        since: string | null;
        partial: string;
        tools: ToolState[];
        tasks?: TaskState[];
        events?: AgentEvent[];
      };
    }
  | { status: string }
  | { error: string };

// The conversation as t3code lays out a thread: the header, the timeline,
// the composer at its foot, the terminal in a panel to the right. The socket to the machine is opened here, by the signed
// link, and everything it says lands in the same list the page was
// rendered from.
export function Conversation({
  session,
  events: initial,
  url,
  shell,
  trouble,
  models,
  faked,
  spend,
}: {
  session: {
    id: string;
    title: string;
    model: string;
    state: string;
    settled: boolean;
  };
  // What the conversation has cost so far, as the page was rendered.
  spend: { usd: number; tokens: number; cached: number; calls: number };
  events: AgentEvent[];
  url: string | null;
  // Whether the machine answered, so a shell on it can be opened.
  shell: boolean;
  trouble: string | null;
  models: ModelOption[];
  faked: boolean;
}) {
  const [events, setEvents] = useState(initial);
  const [partial, setPartial] = useState("");
  const [liveTools, setLiveTools] = useState<Map<string, ToolState>>(new Map());
  const [liveTasks, setLiveTasks] = useState<Map<string, TaskState>>(new Map());
  const [working, setWorking] = useState(session.state === "working");
  const [since, setSince] = useState<string | null>(null);
  const [link, setLink] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [notice, setNotice] = useState<string | null>(trouble);
  const [model, setModel] = useState(session.model);
  // The panel starts open where there is room, as t3code's does, on the
  // terminal; the agents tab lists every subagent and task this
  // conversation has run.
  const [terminal, setTerminal] = useState(shell);
  const [panel, setPanel] = useState<"terminal" | "agents">("terminal");
  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const ws = useRef<WebSocket | null>(null);
  const router = useRouter();

  // The title as the page knows it: renamed by the person through the
  // server, or named by the agent over the socket, whichever came last.
  const [title, setTitle] = useState(session.title);
  useEffect(() => setTitle(session.title), [session.title]);

  // One socket per conversation and machine for as long as the page is
  // open: a fresh link to the same machine does not reopen it, a link to
  // another machine does.
  const urlRef = useRef(url);
  urlRef.current = url;
  const machine = url ? new URL(url).host : null;
  useEffect(() => {
    const url = urlRef.current;
    if (!url) {
      ws.current = null;
      setLink("closed");
      return;
    }
    const socket = new WebSocket(url);
    ws.current = socket;
    socket.onopen = () => setLink("open");
    socket.onmessage = (e) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if ("event" in frame) {
        const ev = frame.event;
        setEvents((all) =>
          all.some((x) => x.seq === ev.seq)
            ? all
            : [...all, ev].sort((a, b) => a.seq - b.seq),
        );
        if (ev.kind === "prompt" || ev.kind === "wake") {
          setWorking(true);
          setSince(ev.at);
          setPartial("");
          setLiveTools(new Map());
          setLiveTasks(new Map());
        }
        if (ev.kind === "text") setPartial("");
        if (ev.kind === "tool")
          setLiveTools((m) => {
            const next = new Map(m);
            next.delete(String(ev.body.toolCallId));
            return next;
          });
        if (ev.kind === "result" || ev.kind === "restart") {
          // What the turn cost is on the page as the server has it.
          router.refresh();
          setWorking(false);
          setPartial("");
          setLiveTools(new Map());
          setLiveTasks(new Map());
        }
        if (ev.kind === "model" && typeof ev.body.model === "string")
          setModel(ev.body.model);
        if (ev.kind === "title" && typeof ev.body.title === "string")
          setTitle(ev.body.title);
      } else if ("stream" in frame) {
        setPartial((p) => p + frame.stream);
      } else if ("tool" in frame) {
        const t = frame.tool;
        setLiveTools((m) =>
          new Map(m).set(t.toolCallId, { ...m.get(t.toolCallId), ...t }),
        );
      } else if ("task" in frame) {
        const t = frame.task;
        setLiveTasks((m) => new Map(m).set(t.id, t));
      } else if ("snapshot" in frame) {
        // The turn under way, with the events that began it, for a page
        // that opened in the middle of one.
        const fresh = frame.snapshot.events ?? [];
        if (fresh.length)
          setEvents((all) => {
            const known = new Set(all.map((x) => x.seq));
            const added = fresh.filter((x) => !known.has(x.seq));
            return added.length
              ? [...all, ...added].sort((a, b) => a.seq - b.seq)
              : all;
          });
        // A conversation begun on the empty page carries its first prompt
        // here, sent once, when the machine says it is idle and has not had
        // it.
        const key = `agent-first-${session.id}`;
        const first = firstPrompt(key);
        if (first) {
          const had =
            frame.snapshot.working || initial.some((e) => e.kind === "prompt");
          if (!had) socket.send(JSON.stringify({ prompt: first }));
        }
        setWorking(frame.snapshot.working);
        setSince(frame.snapshot.since);
        setPartial(frame.snapshot.partial ?? "");
        setLiveTools(
          new Map(frame.snapshot.tools.map((t) => [t.toolCallId, t])),
        );
        setLiveTasks(
          new Map((frame.snapshot.tasks ?? []).map((t) => [t.id, t])),
        );
      } else if ("error" in frame) {
        setNotice(frame.error);
      } else if ("status" in frame && frame.status === "faked") {
        setNotice("The agent is faked here: this deployment has no model key.");
      }
    };
    socket.onclose = (e) => {
      setLink("closed");
      if (e.reason) setNotice(e.reason);
    };
    socket.onerror = () => setLink("closed");
    return () => {
      socket.onclose = null;
      socket.close();
    };
  }, [session.id, machine]);

  const send = (obj: object) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(obj));
  };
  const prompt = (text: string) => {
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setNotice("The machine is not connected. Reload to try again.");
      return;
    }
    // Working from the moment it is asked, so a second prompt waits.
    setWorking(true);
    send({ prompt: text });
  };
  // The shown model follows the daemon's word, not the click.
  const changeModel = (m: string) => {
    if (link !== "open" || working) return;
    send({ model: m });
  };
  const toggle = <T,>(set: ReadonlySet<T>, key: T) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const agentsWorking = [...liveTools.values()].filter((t) => t.agent).length;
  const list = rows(
    events,
    {
      working,
      since,
      partial,
      tools: [...liveTools.values()],
      tasks: [...liveTasks.values()],
    },
    expandedTurns,
    expandedGroups,
  );

  return (
    <div
      className="bg-background relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      data-acp-url={url ?? undefined}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
        <ChatHeader
          session={{ id: session.id, settled: session.settled }}
          title={title}
          status={link}
          terminal={{ open: terminal, available: shell }}
          onTerminal={() => setTerminal((t) => !t)}
          onDelete={() => send({ end: true })}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MessageScrollerProvider>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-0 px-3 pt-3 pb-4 sm:px-5">
                  {list.map((row) => (
                    <MessageScrollerItem
                      key={row.id}
                      data-event={eventOf(row)}
                      scrollAnchor={
                        row.kind === "working" ||
                        row.kind === "thinking" ||
                        (row.kind === "assistant" && row.streaming)
                      }
                    >
                      <TimelineRow
                        row={row}
                        onToggleTurn={(t) =>
                          setExpandedTurns((s) => toggle(s, t))
                        }
                        onToggleGroup={(g) =>
                          setExpandedGroups((s) => toggle(s, g))
                        }
                      />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton
                variant="outline"
                size="xs"
                className="text-muted-foreground hover:text-foreground gap-1.5 rounded-full px-3 shadow-sm"
              >
                <ChevronDown className="size-3.5" />
                Scroll to end
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>

          <div className="shrink-0 px-3 pt-1.5 pb-4 sm:px-5 sm:pt-2 sm:pb-5">
            <Composer
              models={models}
              model={model}
              onModel={changeModel}
              onSend={prompt}
              onStop={() => send({ cancel: true })}
              working={working}
              disabled={link !== "open"}
              placeholder={
                link === "connecting"
                  ? "Connecting to your computer…"
                  : link === "closed"
                    ? "Disconnected from your computer. Reload to reconnect."
                    : "Ask anything…"
              }
              autoFocus
              meter={spend}
            />
            {(notice || faked) && (
              <p
                className="text-muted-foreground mx-auto mt-2 max-w-3xl px-4 text-xs"
                role="status"
                data-notice
              >
                {notice ??
                  "The agent is faked here: this deployment has no model key."}
              </p>
            )}
          </div>
        </div>
      </div>

      {terminal && shell && (
        <aside
          className="hidden w-90 shrink-0 flex-col border-s lg:flex xl:w-110 2xl:w-140"
          data-terminal-pane
        >
          <div className="flex h-13 shrink-0 items-center gap-1 border-b px-2">
            <PanelTab
              active={panel === "terminal"}
              onClick={() => setPanel("terminal")}
            >
              <TerminalSquare aria-hidden className="size-3.5" /> Terminal
            </PanelTab>
            <PanelTab
              active={panel === "agents"}
              onClick={() => setPanel("agents")}
            >
              <Bot aria-hidden className="size-3.5" /> Agents
              {agentsWorking > 0 && (
                <span className="text-sky-700 tabular-nums dark:text-sky-400">
                  {agentsWorking}
                </span>
              )}
            </PanelTab>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setTerminal(false)}
              aria-label="Close panel"
            >
              <X />
            </Button>
          </div>
          <div
            className={cn("min-h-0 flex-1", panel !== "terminal" && "hidden")}
          >
            <Terminal />
          </div>
          {panel === "agents" && (
            <AgentsPanel
              events={events}
              tools={[...liveTools.values()]}
              tasks={[...liveTasks.values()]}
            />
          )}
        </aside>
      )}
    </div>
  );
}

// The first prompt of a conversation begun on the empty page: in storage,
// or in the address when storage would not keep it. Taken once.
function firstPrompt(key: string): string | null {
  try {
    const kept = sessionStorage.getItem(key);
    if (kept) {
      sessionStorage.removeItem(key);
      return kept;
    }
  } catch {}
  const m = window.location.hash.match(/^#first=(.*)$/);
  if (!m) return null;
  window.history.replaceState(null, "", window.location.pathname);
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

// The recorded event a row stands for, for anything reading the page.
function eventOf(row: ReturnType<typeof rows>[number]): string | undefined {
  switch (row.kind) {
    case "user":
      return "prompt";
    case "wake":
      return "wake";
    case "assistant":
      return row.streaming ? undefined : "text";
    case "fold":
      return "result";
    case "work":
      return row.entry.kind;
    case "restart":
      return "restart";
    default:
      return undefined;
  }
}

// One tab of the right panel, as t3code draws them: filled when open.
function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring/70 flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
