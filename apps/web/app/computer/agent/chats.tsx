"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  fold,
  type Command,
  type Content,
  type Context,
  type Item,
  type Mode,
  type Past,
  type PermissionOption,
  type Terminal,
  type ToolKind,
  type Update,
  type Word,
} from "@/app/computer/agent/acp";
import { liveSocket } from "@/lib/live";

// Every conversation the person's computer has open, held once for the
// whole desktop: one socket to the door, the record of each conversation as
// it arrives, and the words the Agent window says back.
// Nothing durable is here; the conversations are on the machine, and the
// next tab finds them where they are.

// A message on the wire, in either direction: what the agent asks and
// answers, and what the door says about the conversations around it.
export type Line = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
  maslow?: Word;
};

// What the agent asks the person before it acts, as it arrives.
export type Ask = {
  askId: number | string;
  title: string;
  kind: ToolKind;
  options: PermissionOption[];
  // A question standing until the person answers it, here or behind the
  // clock: the notification's id is the ask's, with what it offers.
  asked?: { body: string; choices: string[] };
};

// Allow, then always, then refusing: the order a person weighs them in.
const WEIGHT: Record<PermissionOption["kind"], number> = {
  allow_once: 0,
  allow_always: 1,
  reject_once: 2,
  reject_always: 3,
};

// How the agent acts, kept on the device and said to every conversation
// as it opens: bypass, never asking, until the person picks auto.
const MODE = "agent-mode";
const AUTO = "bypassPermissions";

// One conversation as this tab holds it.
export type Chat = {
  id: string;
  items: Item[];
  asks: Ask[];
  running: boolean;
  mode: string | null;
  modes: Mode[];
  commands: Command[];
  context: Context | null;
  title: string | null;
  // The last thing the agent said, as one line.
  preview: string | null;
};

const fresh = (id: string): Chat => ({
  id,
  items: [],
  asks: [],
  running: false,
  mode: null,
  modes: [],
  commands: [],
  context: null,
  title: null,
  preview: null,
});

type Chats = {
  // Why there is no agent to talk to yet, or null once there is.
  away: string | null;
  chats: Record<string, Chat>;
  // Every conversation the machine keeps, newest first.
  past: Past[];
  // What the agent's own terminals have written, by the id the protocol
  // gave each.
  wrote: Record<string, Terminal>;
  // Why something the person tried did not happen.
  refused: string | null;
  // The conversation opened most recently by this tab's own asking.
  newest: string | null;
  begin: () => void;
  open: (id: string) => void;
  name: (id: string, title: string) => void;
  say: (id: string, prompt: Content[]) => void;
  stop: (id: string) => void;
  answer: (id: string, a: Ask, result: unknown) => void;
  turn: (id: string, mode: string) => void;
};

const Room = createContext<Chats | null>(null);

export function ChatsProvider({ children }: { children: ReactNode }) {
  const socket = useRef<WebSocket | null>(null);
  const answers = useRef(new Map<number, (result: unknown) => void>());
  const asked = useRef(0);
  // Whether this tab asked for a new conversation and awaits it.
  const asking = useRef(false);
  const known = useRef(new Set<string>());

  const [away, setAway] = useState<string | null>("Connecting…");
  const [chats, setChats] = useState<Record<string, Chat>>({});
  const [past, setPast] = useState<Past[]>([]);
  const [wrote, setWrote] = useState<Record<string, Terminal>>({});
  const [refused, setRefused] = useState<string | null>(null);
  const [newest, setNewest] = useState<string | null>(null);

  // One conversation changed, made where it was not yet known.
  const patch = useCallback((id: string, f: (c: Chat) => Chat) => {
    setChats((was) => {
      const before = was[id] ?? fresh(id);
      const after = f(before);
      // Nothing changed, nothing re-rendered.
      return after === was[id] ? was : { ...was, [id]: after };
    });
  }, []);

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

  // The conversations the agent keeps, asked for whenever one is opened
  // or named, so the list names every one.
  const list = useCallback(async () => {
    const answer = (await ask("session/list", {})) as
      { sessions?: Past[] } | undefined;
    if (answer?.sessions) setPast(answer.sessions);
  }, [ask]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heard = answers.current;

    // One conversation as the door tells of it, whether it came alone or
    // among the ones the door holds open when a socket arrives.
    const apply = (c: NonNullable<Word["chat"]>) => {
      if (c.clear)
        patch(c.id, (was) => ({
          ...fresh(c.id),
          title: was.title,
          mode: was.mode,
          modes: was.modes,
        }));
      if (c.gone) patch(c.id, (was) => ({ ...was, running: false }));
      if (c.running !== undefined)
        patch(c.id, (was) => ({
          ...was,
          running: c.running!,
          // No prompt, no leave pending from it; a question stands.
          asks: c.running ? was.asks : was.asks.filter((a) => a.asked),
        }));
      if (c.answered !== undefined)
        patch(c.id, (was) => ({
          ...was,
          asks: was.asks.filter((a) => a.askId !== c.answered),
        }));
      if (c.modes) {
        const offered = c.modes.availableModes ?? [];
        // Claude Code opens every conversation asking before it acts;
        // the device's choice, auto until changed, is set over it.
        const kept = localStorage.getItem(MODE) ?? AUTO;
        const now = c.modes.currentModeId ?? null;
        const to =
          now && now !== kept && offered.some((m) => m.id === kept)
            ? kept
            : now;
        if (to !== now)
          void ask("session/set_mode", { sessionId: c.id, modeId: to });
        patch(c.id, (was) => ({ ...was, modes: offered, mode: to }));
      }
      if (c.preview !== undefined) {
        const preview = c.preview;
        patch(c.id, (was) => ({ ...was, preview }));
        setPast((was) =>
          was.map((p) => (p.sessionId === c.id ? { ...p, preview } : p)),
        );
      }
      if (c.title !== undefined) {
        const title = c.title;
        patch(c.id, (was) => ({ ...was, title }));
        setPast((was) =>
          was.map((p) => (p.sessionId === c.id ? { ...p, title } : p)),
        );
      }
      if (c.context !== undefined)
        patch(c.id, (was) => ({ ...was, context: c.context ?? null }));
    };

    const said = (line: Line) => {
      // The door's own word about the conversations.
      if (line.maslow) {
        const w = line.maslow;
        if (w.clear) {
          setChats({});
          setWrote({});
          known.current.clear();
          if (w.session !== undefined && w.chats === undefined)
            setAway(
              "Take the update behind the clock; this computer's door is from before the agent could hold several conversations.",
            );
        }
        if (w.chats)
          for (const c of w.chats) {
            known.current.add(c.id);
            apply(c);
          }
        if (w.chat) {
          const c = w.chat;
          const arrived = !known.current.has(c.id);
          known.current.add(c.id);
          apply(c);
          // The list again when one arrives, is named, or has just said
          // something, so a new agent stands in the rail from its first
          // exchange.
          if (arrived || c.title !== undefined || c.preview !== undefined)
            void list();
          if (arrived && c.clear && asking.current) {
            asking.current = false;
            setNewest(c.id);
          }
        }
        if (w.terminal)
          setWrote((was) => ({ ...was, [w.terminal!.id]: w.terminal! }));
        if (w.state === "failed")
          setAway(w.why ?? "Your agent would not start on your computer.");
        else if (w.state === "ready") {
          setAway(null);
          void list();
        } else if (w.state) setAway("Starting your agent…");
        return;
      }
      const sid = line.params?.sessionId;
      // Something the agent tells the client about one conversation.
      if (line.method === "session/update" && typeof sid === "string") {
        const update = line.params?.update as Update | undefined;
        if (!update) return;
        if (update.sessionUpdate === "_maslow/asked")
          patch(sid, (was) => ({
            ...was,
            asks: [
              ...was.asks.filter((a) => a.askId !== update.id),
              {
                askId: update.id,
                title: update.title,
                kind: "other",
                options: [],
                asked: { body: update.body, choices: update.options },
              },
            ],
          }));
        else if (update.sessionUpdate === "current_mode_update")
          patch(sid, (was) => ({ ...was, mode: update.currentModeId }));
        else if (update.sessionUpdate === "available_commands_update")
          patch(sid, (was) => ({
            ...was,
            commands: update.availableCommands,
          }));
        else patch(sid, (was) => ({ ...was, items: fold(was.items, update) }));
        return;
      }
      // Something the agent asks the person. It blocks nothing else: the
      // rest of the transcript keeps arriving under it.
      if (
        line.method === "session/request_permission" &&
        line.id !== undefined &&
        typeof sid === "string"
      ) {
        const p = line.params as
          | {
              options?: PermissionOption[];
              toolCall?: {
                title?: string;
                toolCallId?: string;
                kind?: ToolKind;
                rawInput?: { command?: unknown };
              };
            }
          | undefined;
        const title = p?.toolCall?.title ?? "Your agent wants to run a tool.";
        // The adapter's own shell tool comes as no kind in particular; a
        // command is known by the command.
        const kind =
          (p?.toolCall?.kind ?? "other") === "other" &&
          (typeof p?.toolCall?.rawInput?.command === "string" ||
            title.startsWith("`"))
            ? "execute"
            : (p?.toolCall?.kind ?? "other");
        const one: Ask = {
          askId: line.id,
          title,
          kind,
          options: [...(p?.options ?? [])].sort(
            (a, b) => WEIGHT[a.kind] - WEIGHT[b.kind],
          ),
        };
        patch(sid, (was) => ({ ...was, asks: [...was.asks, one] }));
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
          setRefused(line.error.message ?? "Your agent could not do that.");
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
          // Nothing will answer what was asked of a socket that is gone,
          // so each waiting ask is let go rather than left mid-await.
          for (const a of heard.values()) a(undefined);
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
  }, [ask, list, patch]);

  // What the desktop says back, each the same function for as long as the
  // socket lives, so nothing that depends on one re-runs as the
  // conversations change under it.
  const begin = useCallback(() => {
    asking.current = true;
    send({ maslow: { fresh: true } });
  }, [send]);
  const open = useCallback(
    (id: string) => send({ maslow: { open: id } }),
    [send],
  );
  // A name the person gives a conversation, kept by the door.
  const name = useCallback(
    (id: string, title: string) => {
      send({ maslow: { name: { id, title } } });
      patch(id, (was) => ({ ...was, title }));
    },
    [send, patch],
  );
  // What the person said, sent as a prompt; a word into a running turn
  // reaches the agent at its next step.
  const say = useCallback(
    (id: string, prompt: Content[]) => {
      setRefused(null);
      patch(id, (was) => ({ ...was, running: true }));
      void ask("session/prompt", { sessionId: id, prompt });
    },
    [ask, patch],
  );
  // The prompt stopped where it is: the agent gives up what it was doing
  // and says so, and what it already did stands.
  const stop = useCallback(
    (id: string) => {
      send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: id },
      });
      patch(id, (was) => ({ ...was, asks: [] }));
    },
    [send, patch],
  );
  // An answer: to a question, through the app, which says it back into
  // the conversation; to leave to act, straight to the agent.
  const answer = useCallback(
    (id: string, a: Ask, result: unknown) => {
      if (a.asked)
        void fetch("/notifications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: a.askId, answer: result }),
        });
      else send({ jsonrpc: "2.0", id: a.askId, result });
      patch(id, (was) => ({
        ...was,
        asks: was.asks.filter((one) => one.askId !== a.askId),
      }));
    },
    [send, patch],
  );
  // How the agent acts from here on: asked, since a line with no number
  // is a notification the agent drops unread.
  const turn = useCallback(
    (id: string, mode: string) => {
      localStorage.setItem(MODE, mode);
      patch(id, (was) => ({ ...was, mode }));
      void ask("session/set_mode", { sessionId: id, modeId: mode });
    },
    [ask, patch],
  );

  const value = useMemo<Chats>(
    () => ({
      away,
      chats,
      past,
      wrote,
      refused,
      newest,
      begin,
      open,
      name,
      say,
      stop,
      answer,
      turn,
    }),
    [
      away,
      chats,
      past,
      wrote,
      refused,
      newest,
      begin,
      open,
      name,
      say,
      stop,
      answer,
      turn,
    ],
  );

  return <Room.Provider value={value}>{children}</Room.Provider>;
}

export function useChats(): Chats {
  const c = useContext(Room);
  if (!c) throw new Error("useChats needs a ChatsProvider above it.");
  return c;
}
