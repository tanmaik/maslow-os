"use client";

import {
  RiAddFill,
  RiChatNewLine,
  RiCloseLine,
  RiImageAddLine,
  RiSideBarLine,
} from "@remixicon/react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fold,
  type Command,
  type Content,
  type Item,
  type Past,
  type Mode,
  type PermissionOption,
  type Model,
  type Session,
  type Terminal,
  type ToolCall,
  type ToolKind,
  type Update,
  type Word,
} from "@/app/computer/agent/acp";
import {
  Plan,
  Thought,
  Tool,
  markFor,
  showingOf,
} from "@/app/computer/agent/transcript";
import { InBar } from "@/app/room/panel";
import {
  AiChatCodePanel,
  type CodePanelShowing,
} from "@/components/application/ai-chat/ai-chat-code-panel";
import { AiChatContainer } from "@/components/application/ai-chat/ai-chat-container";
import { AiChatSidebar } from "@/components/application/ai-chat/ai-chat-sidebar";
import { ComposerLoader } from "@/components/application/composer-loader/composer-loader";
import { Composer } from "@/components/application/ai-chat/ai-chat-composer";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Notification } from "@/components/base/notification/notification";
import { Select, SelectItem } from "@/components/base/select/select";
import { Markdown } from "@/components/markdown";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { UsageLine } from "@/components/usage-card";
import { liveSocket } from "@/lib/live";
import { FAST } from "@/lib/motion";
import { cx } from "@/utils/cx";

// Where Claude Code works on a computer: the person's home, the one place
// there is, never shown and never asked. A conversation that needs another
// folder says so in the prompt.
const HOME = "/home/me";

// Where a file the person hands the agent lands on their computer, made
// when it is first needed.
const ATTACHMENTS = "Attachments";

// The composer's own corner: BoardUI's pill is 52 tall and fully rounded.
const COMPOSER_RADIUS = 26;

// A message on the wire, in either direction: what the agent asks and
// answers, and what the door says about the conversation around it.
type Line = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
  maslow?: Word;
};

// What the agent asks the person before it acts, as it arrives.
type Ask = {
  askId: number | string;
  title: string;
  kind: ToolKind;
  options: PermissionOption[];
};

// Allow, then always, then refusing: the order a person weighs them in.
const WEIGHT: Record<PermissionOption["kind"], number> = {
  allow_once: 0,
  allow_always: 1,
  reject_once: 2,
  reject_always: 3,
};

// Our words, not the agent's shouting: "Always Allow" is "Always allow".
const asAsked = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

// A picture the person is holding for their next prompt: what the protocol
// carries, and what the row under the composer calls it.
type Held = { content: Content; tile: { id: string; name: string } };

// What a conversation on Maslow's key may run on: the two models the key
// pays for, under the names Claude Code's own aliases now point at. On a
// person's own credentials the agent's list stands as it is.
// What a model is called: its own name, unless that name is the agent's
// word for "whatever is set", in which case what it describes is the name.
const modelName = (m: { name: string; description?: string }) =>
  /^default/i.test(m.name) && m.description
    ? m.description.split(/[.,(]/)[0]!.trim()
    : m.name;

const OURS: Model[] = [
  { modelId: "opus", name: "GLM 5.3" },
  { modelId: "default", name: "GLM 5.3 Flash" },
];

// When a conversation was last worked on, short enough for the rail's chip.
function when(at: string | undefined): string {
  if (!at) return "";
  const mins = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

// The person's computer as a conversation: the same Claude Code the
// terminal runs, over the Agent Client Protocol, through the door on the
// machine. Nothing durable is in this tab — the conversation is on the
// machine, and the next tab finds it mid-answer.
export function Agent() {
  const socket = useRef<WebSocket | null>(null);
  const answers = useRef(new Map<number, (result: unknown) => void>());
  const asked = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();

  const [away, setAway] = useState<string | null>("Connecting…");
  const [items, setItems] = useState<Item[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [past, setPast] = useState<Past[]>([]);
  // Whether this computer runs on a key of Maslow's.
  const [ours, setOurs] = useState(false);
  const [modes, setModes] = useState<Mode[]>([]);
  // Whether the conversations are shown beside the transcript.
  const [rail, setRail] = useState(false);
  // Whether the window is too narrow for a rail or a panel beside the
  // conversation, where each opens over it instead.
  const [narrow, setNarrow] = useState(false);
  const [typed, setTyped] = useState("");
  const [held, setHeld] = useState<Held[]>([]);
  // The step whose changes or output the panel is showing.
  const [showing, setShowing] = useState<CodePanelShowing | null>(null);
  // What the agent's own terminals have written, by the id the protocol
  // gave each: the door runs them and says what they write as it arrives.
  const [wrote, setWrote] = useState<Record<string, Terminal>>({});
  // How much of the screen the keyboard takes on a phone, so the composer
  // sits on top of it rather than under it.
  const [keyboard, setKeyboard] = useState(0);
  // Why something the person tried did not happen.
  const [refused, setRefused] = useState<string | null>(null);

  const here = session?.id ?? null;

  const send = useCallback((said: Line) => {
    socket.current?.send(JSON.stringify(said));
  }, []);

  // Something asked of the agent, answered when it answers.
  const ask = useCallback((method: string, params: unknown) => {
    const live = socket.current;
    if (!live) return Promise.resolve(undefined);
    return new Promise<unknown>((answer) => {
      const id = ++asked.current;
      answers.current.set(id, answer);
      live.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }, []);

  // The conversations the agent keeps, asked for whenever this one changes
  // so the rail names the one just left.
  const list = useCallback(async () => {
    const answer = (await ask("session/list", {})) as
      { sessions?: Past[] } | undefined;
    if (answer?.sessions) setPast(answer.sessions);
  }, [ask]);

  useEffect(() => {
    if (here) void list();
  }, [here, list]);

  // The transcript follows the newest line.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, asks, running, wrote]);

  // A phone's keyboard takes the bottom of the screen without the page
  // knowing; the visual viewport is the one thing that says so.
  useEffect(() => {
    const small = window.matchMedia("(max-width: 639px)");
    const read = () => setNarrow(small.matches);
    small.addEventListener("change", read);
    read();
    return () => small.removeEventListener("change", read);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () =>
      setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    measure();
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heard = answers.current;

    const said = (line: Line) => {
      // The door's own word about the conversation.
      if (line.maslow) {
        const w = line.maslow;
        if (w.clear) {
          setItems([]);
          setAsks([]);
          setCommands([]);
          setShowing(null);
          setWrote({});
        }
        if (w.session !== undefined) {
          setSession(w.session ?? null);
          setModes(w.session?.modes?.availableModes ?? []);
          setMode(w.session?.modes?.currentModeId ?? null);
          setModel(w.session?.models?.currentModelId ?? null);
        }
        if (w.managed !== undefined) setOurs(w.managed);
        if (w.running !== undefined) setRunning(w.running);
        if (w.terminal)
          setWrote((was) => ({ ...was, [w.terminal!.id]: w.terminal! }));
        if (w.state === "failed")
          setAway(w.why ?? "Claude Code would not start on your computer.");
        else if (w.state === "ready") setAway(null);
        else if (w.state) setAway("Starting Claude Code…");
        return;
      }
      // Something the agent tells the client.
      if (line.method === "session/update") {
        const update = line.params?.update as Update | undefined;
        if (!update) return;
        if (update.sessionUpdate === "current_mode_update")
          setMode(update.currentModeId);
        else if (update.sessionUpdate === "available_commands_update")
          setCommands(update.availableCommands);
        else setItems((was) => fold(was, update));
        return;
      }
      // Something the agent asks the person. It blocks nothing else: the
      // rest of the transcript keeps arriving under it.
      if (
        line.method === "session/request_permission" &&
        line.id !== undefined
      ) {
        const p = line.params as
          | {
              options?: PermissionOption[];
              toolCall?: {
                title?: string;
                toolCallId?: string;
                kind?: ToolKind;
              };
            }
          | undefined;
        const about = p?.toolCall?.toolCallId;
        setAsks((was) => [
          ...was,
          {
            askId: line.id!,
            title: p?.toolCall?.title ?? "Claude Code wants to run a tool.",
            kind: p?.toolCall?.kind ?? kindOf(about),
            options: [...(p?.options ?? [])].sort(
              (a, b) => WEIGHT[a.kind] - WEIGHT[b.kind],
            ),
          },
        ]);
        return;
      }
      // An answer to something asked here. An agent that refuses — no
      // credit, no auth, a prompt it would not take — says why, and the
      // person reads it rather than watching nothing happen.
      if (line.id !== undefined && line.method === undefined) {
        const answer = heard.get(line.id as number);
        if (!answer) return;
        heard.delete(line.id as number);
        if (line.error)
          setRefused(line.error.message ?? "Claude Code could not do that.");
        answer(line.result);
      }
    };

    const connect = async () => {
      try {
        const next = await liveSocket("agent");
        if (stopped) return next.close();
        socket.current = next;
        next.onmessage = (m) => said(JSON.parse(m.data as string) as Line);
        next.onclose = () => {
          socket.current = null;
          heard.clear();
          if (stopped) return;
          setAway("Reconnecting…");
          timer = setTimeout(connect, 1000);
        };
        // The protocol's first word. The door holds the one client the
        // process takes and answers from what the agent told it, so this
        // says what this page can do: no hands of ours on the machine,
        // since Claude Code has its own there.
        const id = ++asked.current;
        heard.set(id, () => {});
        next.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "initialize",
            params: {
              protocolVersion: 1,
              clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false,
              },
            },
          }),
        );
      } catch (err) {
        if (stopped) return;
        setAway((err as Error).message);
        timer = setTimeout(connect, 5000);
      }
    };
    void connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, []);

  // What the person said, sent as a prompt: their words and the pictures
  // they attached to them.
  const say = (text: string) => {
    const words = text.trim();
    if ((!words && held.length === 0) || !here || running) return;
    const prompt: Content[] = [
      ...held.map((h) => h.content),
      ...(words ? [{ type: "text" as const, text: words }] : []),
    ];
    setTyped("");
    setHeld([]);
    setRefused(null);
    setRunning(true);
    void ask("session/prompt", { sessionId: here, prompt });
  };

  // The prompt stopped where it is: the agent gives up what it was doing
  // and says so, and what it already did stands.
  const stop = useCallback(() => {
    if (!here) return;
    send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: here },
    });
  }, [here, send]);

  const answer = (a: Ask, optionId: string) => {
    send({
      jsonrpc: "2.0",
      id: a.askId,
      result: { outcome: { outcome: "selected", optionId } },
    });
    setAsks((was) => was.filter((one) => one.askId !== a.askId));
  };

  // Something from this device to go with the next prompt. A picture rides
  // in the prompt itself, as the protocol carries one; anything else is put
  // on the computer first, in the person's own Attachments folder, and the
  // prompt says where it landed, so Claude Code reads it there with its own
  // hands rather than through us.
  const attach = async (chosen: File) => {
    const id = `${Date.now()}-${chosen.name}`;
    if (chosen.type.startsWith("image/")) {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      let raw = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setHeld((was) => [
        ...was,
        {
          content: { type: "image", data: btoa(raw), mimeType: chosen.type },
          tile: { id, name: chosen.name },
        },
      ]);
      return;
    }
    setRefused(null);
    const target = await fetch("/computer/files/upload", { method: "POST" });
    if (!target.ok) return setRefused(await target.text());
    const { door, ticket } = (await target.json()) as {
      door: string;
      ticket: string;
    };
    const at = `${ATTACHMENTS}/${chosen.name}`;
    const where = `${door}/upload?path=${encodeURIComponent(at)}&total=${chosen.size}&modified=${chosen.lastModified}&offset=0`;
    const put = await fetch(where, {
      method: "PUT",
      headers: {
        "x-maslow-ticket": ticket,
        "content-type": "application/octet-stream",
      },
      body: chosen,
    }).catch(() => null);
    if (!put || put.status !== 201)
      return setRefused(`${chosen.name} could not be put on your computer.`);
    setHeld((was) => [
      ...was,
      {
        content: {
          type: "resource_link",
          uri: `file://${HOME}/${at}`,
          name: chosen.name,
        },
        tile: { id, name: chosen.name },
      },
    ]);
  };

  // The commands this conversation offers, once the person types a slash.
  const offered =
    typed.startsWith("/") && !typed.includes(" ")
      ? commands.filter((c) => c.name.startsWith(typed.slice(1))).slice(0, 8)
      : [];

  const turn = (to: string) => {
    if (!here) return;
    setMode(to);
    send({
      jsonrpc: "2.0",
      method: "session/set_mode",
      params: { sessionId: here, modeId: to },
    });
  };

  // What this conversation may run on: the two Maslow's key pays for, or
  // whatever the person's own account lists.
  const models = ours
    ? OURS.filter((o) =>
        (session?.models?.availableModels ?? []).some(
          (m) => m.modelId === o.modelId,
        ),
      )
    : (session?.models?.availableModels ?? []);

  // Which model this conversation runs on, which is Claude Code's own
  // setting on the machine, so the terminal picks it up too.
  const pickModel = (id: string) => {
    setModel(id);
    if (here)
      send({
        jsonrpc: "2.0",
        method: "session/set_model",
        params: { sessionId: here, modelId: id },
      });
  };

  // The kind of work an ask is about, from the row it belongs to.
  const kindOf = (toolCallId: string | undefined): ToolKind => {
    const row = items.find(
      (i) => i.kind === "tool" && i.call.toolCallId === toolCallId,
    );
    return row?.kind === "tool" ? row.call.kind : "other";
  };

  // The steps a subagent took, in the order they came.
  const stepsUnder = (toolCallId: string) =>
    items.flatMap((i) =>
      i.kind === "tool" && i.under === toolCallId ? [i.call] : [],
    );

  // A step opened in the panel beside the conversation, where it has
  // anything to show.
  const open = (call: ToolCall) =>
    setShowing(showingOf(call, terminalOf(call)));

  // The terminal a row's command runs in, where it has one.
  const terminalOf = (call: ToolCall) => {
    const at = call.content.find((c) => c.type === "terminal");
    return at?.type === "terminal" ? wrote[at.terminalId] : undefined;
  };

  // What the conversations rail is given, wherever it is drawn.
  const railProps = {
    groupLabel: "Conversations",
    head: (
      <span className="px-1 text-headline-medium text-text-primary">
        Conversations
      </span>
    ),
    footer: null,
    actions: [
      {
        icon: RiAddFill,
        label: "New conversation",
        onClick: () => send({ maslow: { fresh: true } }),
      },
    ],
    repos: [
      {
        label: HOME,
        defaultOpen: true,
        threads: past.map((p) => ({
          id: p.sessionId,
          label: p.title ?? "New conversation",
          time: when(p.updatedAt),
        })),
      },
    ],
    activeThreadId: here ?? undefined,
    onThreadSelect: (id: string) => {
      setRail(false);
      if (id !== here) send({ maslow: { open: id } });
    },
  };

  const thread = (
    <div
      className="min-h-0 w-full flex-1 overflow-y-auto p-3 sm:p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && running) {
          e.preventDefault();
          stop();
        }
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {items.length === 0 && asks.length === 0 && (
          <p className="text-body-regular text-text-tertiary">
            This is Claude Code on your computer. Ask it for anything there, and
            it works in your home as you.
          </p>
        )}
        {items
          .filter((item) => item.kind !== "tool" || !item.under)
          .map((item) => (
            <motion.div
              key={item.id}
              initial={still ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={FAST}
            >
              {item.kind === "said" && item.who === "person" && (
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl bg-background-tertiary-default px-3 py-2 text-body-regular whitespace-pre-wrap text-text-primary">
                    {item.text}
                  </p>
                </div>
              )}
              {item.kind === "said" && item.who === "agent" && (
                <Markdown>{item.text}</Markdown>
              )}
              {item.kind === "thought" && <Thought text={item.text} />}
              {item.kind === "tool" && (
                <Tool
                  call={item.call}
                  steps={stepsUnder(item.call.toolCallId)}
                  terminal={terminalOf(item.call)}
                  onOpen={() => open(item.call)}
                />
              )}
              {item.kind === "plan" && <Plan entries={item.entries} />}
            </motion.div>
          ))}
        {/* What the agent asks before it acts, answered here and nowhere
            else. */}
        {asks.map((a) => (
          <Notification
            key={String(a.askId)}
            status="neutral"
            icon={markFor(a.kind)}
            dismissible={false}
            className="ring-1 ring-accent-500"
            title={a.title}
            description="Always allow lasts for this conversation."
            actions={a.options.map((o) => ({
              label: asAsked(o.name),
              variant:
                o.kind === "allow_once"
                  ? ("primary" as const)
                  : ("secondary" as const),
              onClick: () => answer(a, o.optionId),
            }))}
          />
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );

  // What the person says next: Enter sends it, Shift and Enter makes a
  // line, a slash offers what this conversation knows, and while a prompt
  // runs the composer carries the light and the way to end it.
  const composer = (
    <div style={{ paddingBottom: keyboard || undefined }}>
      {offered.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-2lg border border-border-button-default bg-background-primary-default">
          {offered.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => setTyped(`/${c.name} `)}
                className="flex min-h-11 w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left transition-colors duration-fast ease-plain outline-none hover:bg-background-secondary-hover focus-visible:bg-background-secondary-hover"
              >
                <span className="text-body-2-medium text-text-primary">
                  /{c.name}
                </span>
                <span className="truncate text-caption-1-regular text-text-tertiary">
                  {c.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* The light is the composer's own box and nothing outside it: the
          pill is 52 tall, so its corner is 26, and the wrapper clips to
          the same shape the band is drawn on. */}
      <div className="overflow-hidden rounded-[26px]">
        <ComposerLoader active={running && !still} radius={COMPOSER_RADIUS}>
          <Composer
            className="bg-transparent shadow-none"
            modelMenu={false}
            mic={false}
            add={
              <label
                title="Attach a file"
                aria-label="Attach a file"
                className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background-secondary-default text-foreground-icon-primary transition-colors duration-fast ease-plain hover:bg-background-secondary-hover"
              >
                <input
                  type="file"
                  className="sr-only"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    if (chosen) void attach(chosen);
                    e.target.value = "";
                  }}
                />
                <RiImageAddLine className="size-5" aria-hidden />
                <span className="sr-only">Attach a file</span>
              </label>
            }
            value={typed}
            onValueChange={setTyped}
            onSubmit={say}
            disabled={away !== null || running}
            busy={running}
            onStop={stop}
            placeholder={away ?? "Ask Claude Code to do something"}
          />
        </ComposerLoader>
      </div>
      {/* The pictures waiting to go with the next prompt, and what the
          week has cost so far. */}
      {held.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {held.map((h) => (
            <button
              key={h.tile.id}
              type="button"
              onClick={() =>
                setHeld((was) => was.filter((o) => o.tile.id !== h.tile.id))
              }
              className="flex cursor-pointer items-center gap-1 rounded-full bg-background-secondary-default px-3 py-1 text-caption-1-medium text-text-secondary transition-colors duration-fast ease-plain hover:bg-background-secondary-hover"
            >
              {h.tile.name}
              <RiCloseLine className="size-3.5" aria-hidden />
            </button>
          ))}
        </div>
      )}
      {refused !== null && (
        <p className="mt-1 px-3 text-caption-1-regular text-text-error-primary">
          {refused}
        </p>
      )}
      <div className="mt-1 flex justify-end px-3">
        <UsageLine className="text-caption-1-regular text-text-tertiary" />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-background-primary-default">
      {/* Everything this conversation is: whether its list is shown, how
          it acts, what it runs on, and the way to begin another. */}
      <InBar
        as={(controls) => (
          <div className="flex h-[45px] shrink-0 items-center gap-1 overflow-x-auto border-b border-separator-border px-2">
            {controls}
          </div>
        )}
      >
        <IconButton
          size="small"
          icon={RiSideBarLine}
          aria-label={rail ? "Hide the conversations" : "Conversations"}
          title={rail ? "Hide the conversations" : "Conversations"}
          aria-pressed={rail}
          onClick={() => setRail((on) => !on)}
          className={cx(!rail && "text-foreground-icon-tertiary")}
        />
        {modes.length > 0 && (
          <Select
            size="sm"
            aria-label="How it acts"
            selectedKey={mode}
            onSelectionChange={(key) => turn(String(key))}
            popoverClassName="w-56"
          >
            {modes.map((m) => (
              <SelectItem key={m.id} id={m.id} textValue={m.name}>
                {m.name}
              </SelectItem>
            ))}
          </Select>
        )}
        {models.length > 0 && (
          <Select
            size="sm"
            aria-label="Model"
            selectedKey={
              models.some((m) => m.modelId === model)
                ? model
                : (models[0]?.modelId ?? null)
            }
            onSelectionChange={(key) => pickModel(String(key))}
            popoverClassName="w-64"
          >
            {models.map((m) => (
              <SelectItem
                key={m.modelId}
                id={m.modelId}
                textValue={modelName(m)}
              >
                {modelName(m)}
              </SelectItem>
            ))}
          </Select>
        )}
        <IconButton
          size="small"
          icon={RiChatNewLine}
          aria-label="New conversation"
          title="New conversation"
          onClick={() => send({ maslow: { fresh: true } })}
        />
      </InBar>
      <div className="flex min-h-0 w-full flex-1">
        {/* The conversations kept on the machine: beside the transcript
            where there is room, and over it on a phone. */}
        {rail && (
          <AiChatSidebar
            {...railProps}
            className="hidden rounded-none border-0 border-r border-separator-border bg-background-secondary-default/55 shadow-none sm:flex"
          />
        )}
        <Sheet open={rail && narrow} onOpenChange={setRail}>
          <SheetContent side="left" className="w-72 p-0 sm:hidden">
            <SheetTitle className="sr-only">Conversations</SheetTitle>
            <AiChatSidebar {...railProps} flat className="w-full" />
          </SheetContent>
        </Sheet>
        <AiChatContainer
          className="min-w-0 flex-1 rounded-none bg-background-primary-default"
          title={null}
          working={false}
          thread={thread}
          composer={composer}
        />
        {/* What a step did, beside the conversation on a wide window and
          over it on a narrow one. */}
        {showing && (
          <div className="hidden w-[380px] shrink-0 border-l border-separator-border px-3 lg:flex">
            <AiChatCodePanel
              width="100%"
              className="min-h-0 flex-1"
              showing={showing}
              onClose={() => setShowing(null)}
            />
          </div>
        )}
        <Sheet
          open={showing !== null && narrow}
          onOpenChange={(on) => !on && setShowing(null)}
        >
          <SheetContent
            side="right"
            className="w-[min(420px,100vw)] p-3 lg:hidden"
          >
            <SheetTitle className="sr-only">What this step did</SheetTitle>
            <AiChatCodePanel
              width="100%"
              className="min-h-0 flex-1"
              showing={showing}
              onClose={() => setShowing(null)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
