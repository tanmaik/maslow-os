"use client";

import {
  RiAddFill,
  RiAttachment2,
  RiChatNewLine,
  RiSideBarLine,
  RiArrowDownSLine,
} from "@remixicon/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { PhoneSheet, SheetRow } from "@/app/desktop/sheet";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Content, Past } from "@/app/computer/agent/acp";
import { useChats } from "@/app/computer/agent/chats";
import { useEar } from "@/app/computer/agent/ear";
import { AskSheet } from "@/app/computer/agent/leave";
import { Status } from "@/app/computer/agent/status";
import { Talk } from "@/app/computer/agent/talk";
import { Thread } from "@/app/computer/agent/thread";
import { BarButton, InBar, useFolded } from "@/app/desktop/panel";
import { Composer } from "@/components/application/ai-chat/ai-chat-composer";
import { AiChatShell } from "@/components/application/ai-chat/ai-chat-shell";
import type { AiChatRepo } from "@/components/application/ai-chat/ai-chat-sidebar";
import { ComposerLoader } from "@/components/application/composer-loader/composer-loader";
import {
  ComposerAttachmentStrip,
  type ComposerAttachment,
  type ComposerAttachmentKind,
} from "@/components/application/composer-panel/composer-panel";
import { IconButton } from "@/components/base/buttons/icon-button";

// Where Claude Code works on a computer: the person's home, the one place
// there is, never shown and never asked. A conversation that needs another
// folder says so in words, and Claude Code goes there itself.
const HOME = "/home/me";
// Where a file the person hands the agent lands on their computer, made
// as needed, so the agent reads it there with its own hands.
const ATTACHMENTS = "Attachments";

// What the device keeps: whether the rail stands open, and which chats
// the person pinned to the top of it.
const RAIL = "agent-rail";
const PINS = "agent-pins";

// A file the person is holding for their next prompt: the tile the strip
// shows, and what the protocol will carry once the file has landed.
type Held = { tile: ComposerAttachment; content?: Content };

// What a file is, to the strip, by its ending.
function kindOf(name: string, type: string): ComposerAttachmentKind {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  const end = name.split(".").pop()?.toLowerCase() ?? "";
  if (/^(xlsx?|csv|numbers|ods)$/.test(end)) return "spreadsheet";
  if (/^(pptx?|key|odp)$/.test(end)) return "presentation";
  if (
    /^(js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|cs|swift|kt|sh|json|yml|yaml|toml|css|html|sql)$/.test(
      end,
    )
  )
    return "code";
  return "document";
}

// Words heard put after what was typed, with a space between where one
// is missing.
const join = (typed: string, heard: string) =>
  heard ? `${typed}${typed && !typed.endsWith(" ") ? " " : ""}${heard}` : typed;

// An agent's mark: its initial on a colour of its own, the same colour
// every time from its name.
const COLOURS = ["blue", "lime", "pink"] as const;
function Mark({ name, size = "sm" }: { name: string; size?: "xs" | "sm" }) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.codePointAt(0)!) % 9973;
  return (
    <Avatar
      size={size}
      color={COLOURS[n % COLOURS.length]}
      initials={(name.trim()[0] ?? "?").toUpperCase()}
      className="shrink-0"
    />
  );
}

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
// machine, drawn as BoardUI's chat: the rail of chats, the thread and the
// pill. One conversation is in view at a time; the rest stand open behind
// it, running on, and the rail shows them all.
export function Agent({ href }: { href?: string } = {}) {
  const still = useReducedMotion();
  const wanted = href
    ? new URL(href, "http://desktop").searchParams.get("chat")
    : null;
  const {
    away,
    chats,
    past,
    refused,
    newest,
    begin,
    open,
    say: sayTo,
    stop,
    answer,
    turn,
    name,
  } = useChats();

  // The conversation in view: the one asked for, else the one this tab
  // opened last, else the newest open one.
  const [current, setCurrent] = useState<string | null>(wanted ?? null);
  useEffect(() => {
    if (wanted) setCurrent(wanted);
  }, [wanted]);
  useEffect(() => {
    if (newest) setCurrent(newest);
  }, [newest]);
  const ids = Object.keys(chats);
  const here = current ?? ids.at(-1) ?? null;
  const chat = here ? chats[here] : undefined;

  // Whether the rail of chats stands beside the conversation, and which
  // chats are pinned to its top: both the device's to remember.
  const [rail, setRail] = useState(true);
  const showRail = (on: boolean) => {
    setRail(on);
    localStorage.setItem(RAIL, on ? "open" : "shut");
  };
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    setRail(localStorage.getItem(RAIL) !== "shut");
    try {
      setPins(JSON.parse(localStorage.getItem(PINS) ?? "[]") as string[]);
    } catch {
      setPins([]);
    }
  }, []);
  const [typed, setTyped] = useState("");
  const [held, setHeld] = useState<Held[]>([]);
  const ear = useEar();
  const folded = useFolded();
  // On a phone a chat opens in voice mode, the keyboard one tap away. On
  // every device the window opens on the last agent spoken to, never on
  // an empty one.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!current && ids.length === 0 && past[0]) {
      open(past[0].sessionId);
      setCurrent(past[0].sessionId);
    }
  }, [current, ids.length, past, open]);
  // The name the person typed for the agent they are making, given to the
  // conversation the moment the door hands it over.
  const [naming, setNaming] = useState(false);
  const christening = useRef<string | null>(null);
  useEffect(() => {
    if (newest && christening.current) {
      name(newest, christening.current);
      christening.current = null;
    }
  }, [newest, name]);
  const make = (title: string) => {
    christening.current = title;
    setNaming(false);
    begin();
  };
  // Why a file could not be attached.
  const [failed, setFailed] = useState<string | null>(null);
  const why = failed ?? refused;
  // Words said before there was a conversation to say them to, sent the
  // moment one opens.
  const pending = useRef<Content[] | null>(null);
  useEffect(() => {
    if (newest && pending.current) {
      sayTo(newest, pending.current);
      pending.current = null;
    }
  }, [newest, sayTo]);

  // What the person said, sent as a prompt: their words and the files
  // they attached to them, once every file has landed. With no
  // conversation open yet, one is opened for it.
  const say = (text: string) => {
    const words = text.trim();
    if (!words && held.length === 0) return;
    if (held.some((h) => !h.content)) return;
    const prompt: Content[] = [
      ...held.flatMap((h) => (h.content ? [h.content] : [])),
      ...(words ? [{ type: "text" as const, text: words }] : []),
    ];
    setTyped("");
    setHeld([]);
    setFailed(null);
    if (here) sayTo(here, prompt);
    else {
      pending.current = prompt;
      begin();
    }
  };

  // Something from this device to go with the next prompt. A picture rides
  // in the prompt itself, as the protocol carries one; anything else is put
  // on the computer first, in the person's own Attachments folder, its
  // tile drawing the ring as it lands, and the prompt says where it landed,
  // so Claude Code reads it there with its own hands rather than through us.
  const attach = async (chosen: File) => {
    const id = `${Date.now()}-${chosen.name}`;
    const kind = kindOf(chosen.name, chosen.type);
    if (kind === "image") {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      let raw = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = btoa(raw);
      setHeld((was) => [
        ...was,
        {
          tile: {
            id,
            name: chosen.name,
            kind,
            src: `data:${chosen.type};base64,${data}`,
          },
          content: { type: "image", data, mimeType: chosen.type },
        },
      ]);
      return;
    }
    setFailed(null);
    setHeld((was) => [
      ...was,
      { tile: { id, name: chosen.name, kind, progress: 0 } },
    ]);
    const drop = () => setHeld((was) => was.filter((h) => h.tile.id !== id));
    const target = await fetch("/computer/files/upload", { method: "POST" });
    if (!target.ok) {
      drop();
      return setFailed(await target.text());
    }
    const { door, ticket } = (await target.json()) as {
      door: string;
      ticket: string;
    };
    const at = `${ATTACHMENTS}/${chosen.name}`;
    const where = `${door}/upload?path=${encodeURIComponent(at)}&total=${chosen.size}&modified=${chosen.lastModified}&offset=0`;
    const landed = await new Promise<boolean>((done) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", where);
      xhr.setRequestHeader("x-maslow-ticket", ticket);
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const progress = Math.min(99, Math.round((e.loaded / e.total) * 100));
        setHeld((was) =>
          was.map((h) =>
            h.tile.id === id ? { ...h, tile: { ...h.tile, progress } } : h,
          ),
        );
      };
      xhr.onload = () => done(xhr.status === 201);
      xhr.onerror = () => done(false);
      xhr.send(chosen);
    });
    if (!landed) {
      drop();
      return setFailed(`${chosen.name} could not be put on your computer.`);
    }
    setHeld((was) =>
      was.map((h) =>
        h.tile.id === id
          ? {
              tile: { id, name: chosen.name, kind },
              content: {
                type: "resource_link",
                uri: `file://${HOME}/${at}`,
                name: chosen.name,
              },
            }
          : h,
      ),
    );
  };

  // The desk's mic: the same ear, clicked on and off, its words landing in
  // the field beside what was typed while it listened. On a phone the mic
  // is the way back to voice mode.
  const base = useRef("");
  useEffect(() => {
    if (ear.on && !folded) setTyped(join(base.current, ear.heard));
  }, [ear.on, ear.heard, folded]);
  const listen = (on: boolean) => {
    if (folded) return setTyping(false);
    if (on) {
      base.current = typed;
      void ear.start();
    } else void ear.stop().then((text) => setTyped(join(base.current, text)));
  };

  // The commands this conversation offers, once the person types a slash.
  const offered =
    typed.startsWith("/") && !typed.includes(" ")
      ? (chat?.commands ?? [])
          .filter((c) => c.name.startsWith(typed.slice(1)))
          .slice(0, 8)
      : [];

  // The rail: pinned chats first, then the rest, newest first, and no
  // folders anywhere.
  const keep = (next: string[]) => {
    setPins(next);
    localStorage.setItem(PINS, JSON.stringify(next));
  };
  const nameOf = (p: Past) => chats[p.sessionId]?.title ?? p.title ?? "Agent";
  const row = (p: Past) => ({
    id: p.sessionId,
    label: nameOf(p),
    avatar: <Mark name={nameOf(p)} />,
    preview: chats[p.sessionId]?.running
      ? "Working…"
      : (chats[p.sessionId]?.preview ?? p.preview ?? ""),
    time: when(p.updatedAt),
    pinned: pins.includes(p.sessionId),
  });
  const pinned = past.filter((p) => pins.includes(p.sessionId));
  const rest = past.filter((p) => !pins.includes(p.sessionId));
  const repos: AiChatRepo[] = [
    ...(pinned.length
      ? [{ label: "Pinned", bare: true, threads: pinned.map(row) }]
      : []),
    {
      label: pinned.length ? "Recent" : "",
      bare: true,
      threads: rest.map(row),
    },
  ];

  const title =
    chat?.title ?? past.find((p) => p.sessionId === here)?.title ?? "Agent";
  // The sheet a new agent is named on, since one is never made unnamed.
  const christen = (
    <Christen open={naming} onMake={make} onClose={() => setNaming(false)} />
  );

  const running = chat?.running ?? false;
  const transcript = chat ? (
    <Thread
      chat={chat}
      onAnswer={(a, result) => answer(chat.id, a, result)}
      onStop={() => stop(chat.id)}
    />
  ) : (
    <div className="min-h-0 flex-1" />
  );

  // What the person says next: Enter sends it, a slash offers what this
  // conversation knows, the files they attached wait above the pill as
  // tiles, and while a prompt runs the pill carries the light and the way
  // to end it. Under it, how the agent acts, the week's spend and how full
  // the conversation is.
  const composer = (
    <div className="flex flex-col gap-2.5">
      {offered.length > 0 && (
        <ul className="overflow-hidden rounded-2lg border border-border-button-default bg-background-primary-default">
          {offered.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => setTyped(`/${c.name} `)}
                className="flex min-h-11 w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left transition-colors duration-fast ease-plain outline-none hover:bg-background-secondary-hover focus-visible:bg-background-secondary-hover"
              >
                <span className="text-body-medium text-text-primary">
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
      {held.length > 0 && (
        <ComposerAttachmentStrip
          attachments={held.map((h) => h.tile)}
          onRemove={(id) =>
            setHeld((was) => was.filter((h) => h.tile.id !== id))
          }
          className="px-1.5"
        />
      )}
      <ComposerLoader active={running && !still}>
        <Composer
          add={
            <label
              title="Attach a file"
              aria-label="Attach a file"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background-secondary-default text-foreground-icon-primary transition-colors duration-fast ease-plain hover:bg-background-secondary-hover"
            >
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  for (const chosen of Array.from(e.target.files ?? []))
                    void attach(chosen);
                  e.target.value = "";
                }}
              />
              <RiAttachment2 className="size-5" aria-hidden />
            </label>
          }
          // The model is the deployment's, not the person's to pick or to
          // be told: the composer names none.
          modelMenu={false}
          listening={ear.on}
          onListen={listen}
          value={typed}
          onValueChange={setTyped}
          onSubmit={say}
          disabled={away !== null || held.some((h) => !h.content)}
          busy={running}
          onStop={() => here && stop(here)}
          // The loader paints the pill and orbits its rim; a pill painting
          // its own ground would cover the light.
          className="bg-transparent shadow-none dark:bg-transparent"
          placeholder={away ?? (here ? `Message ${title}` : "Make an agent")}
        />
      </ComposerLoader>
      {why !== null && (
        <p className="px-3 text-caption-1-regular text-text-error-primary">
          {why}
        </p>
      )}
      <div className="px-1.5">
        <Status
          mode={chat?.mode ?? null}
          modes={chat?.modes ?? []}
          onMode={(mode) => here && turn(here, mode)}
          context={chat?.context ?? null}
        />
      </div>
    </div>
  );

  // Whether the list of chats is open on a phone.
  const [picking, setPicking] = useState(false);
  // On a phone the window is the conversation alone: the chats as a
  // picker under the bar, and under it either the voice mode or the
  // thread with the keyboard.
  if (folded)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <InBar phone="strip">
          <button
            type="button"
            aria-label="Chat"
            aria-expanded={picking}
            onClick={() => setPicking(true)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-lg text-left text-body-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <Mark name={title} size="xs" />
            <span className="truncate">{title}</span>
            <RiArrowDownSLine
              className="size-4 shrink-0 text-foreground-icon-secondary"
              aria-hidden
            />
          </button>
          <BarButton
            icon={RiChatNewLine}
            label="New agent"
            onClick={() => setNaming(true)}
          />
        </InBar>
        {christen}
        <PhoneSheet
          open={picking}
          onClose={() => setPicking(false)}
          label="Agents"
        >
          <SheetRow
            onClick={() => {
              setPicking(false);
              setNaming(true);
            }}
          >
            New agent
          </SheetRow>
          {here && !past.some((p) => p.sessionId === here) && (
            <SheetRow onClick={() => setPicking(false)}>
              <span className="text-text-primary">
                {chat?.title ?? "Agent"}
              </span>
            </SheetRow>
          )}
          {past.map((p) => (
            <SheetRow
              key={p.sessionId}
              onClick={() => {
                setPicking(false);
                if (p.sessionId !== here) {
                  open(p.sessionId);
                  setCurrent(p.sessionId);
                }
              }}
            >
              <span
                className={
                  p.sessionId === here ? "text-text-primary" : undefined
                }
              >
                {nameOf(p)}
              </span>
            </SheetRow>
          ))}
        </PhoneSheet>
        <AskSheet
          ask={chat?.asks[0] ?? null}
          onAnswer={(a, result) => chat && answer(chat.id, a, result)}
        />
        {typing ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col">{transcript}</div>
            <div className="shrink-0 px-3 pb-3">{composer}</div>
          </>
        ) : (
          <Talk
            chat={chat ?? null}
            ear={ear}
            note={why ?? away}
            onSay={say}
            onType={() => setTyping(true)}
          />
        )}
      </div>
    );
  return (
    <>
      {christen}
      <AiChatShell
        className="h-full"
        composer={composer}
        wired={{
          repos,
          groupLabel: "Agents",
          head: null,
          actions: [
            {
              label: "New agent",
              icon: RiAddFill,
              onClick: () => setNaming(true),
            },
          ],
          sidebarFooter: null,
          sidebar: rail,
          activeThreadId: here ?? undefined,
          onThreadSelect: (id: string) => {
            if (id !== here) {
              open(id);
              setCurrent(id);
            }
          },
          onThreadPin: (id, on) =>
            keep(
              on
                ? [...pins.filter((p) => p !== id), id]
                : pins.filter((p) => p !== id),
            ),
          thread: transcript,
          title: (
            <span className="flex min-w-0 items-center gap-2">
              <Mark name={title} size="xs" />
              <Named title={title} onName={(t) => here && name(here, t)} />
            </span>
          ),
          headerActions: (
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                size="small"
                icon={RiSideBarLine}
                aria-label={rail ? "Hide the agents" : "Show the agents"}
                title={rail ? "Hide the agents" : "Show the agents"}
                aria-pressed={rail}
                onClick={() => showRail(!rail)}
              />
            </div>
          ),
          working: false,
        }}
      />
    </>
  );
}

// Where a new agent gets its name before it exists: the name is the one
// thing asked, and Return makes it.
function Christen({
  open,
  onMake,
  onClose,
}: {
  open: boolean;
  onMake: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setDraft("");
  }, [open]);
  const make = () => {
    const t = draft.trim();
    if (t) onMake(t.slice(0, 60));
  };
  return (
    <Dialog open={open} onOpenChange={(now) => !now && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Name it for what it does. It stays in the rail, and you talk to it
            by name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            make();
          }}
        >
          <InputBase
            autoFocus
            aria-label="Name"
            placeholder="Sales Outbound"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <DialogFooter>
            <DialogClose
              render={<Button variant="secondary" size="small" type="button" />}
            >
              Cancel
            </DialogClose>
            <Button size="small" type="submit" disabled={!draft.trim()}>
              Make
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The conversation's name, which a click turns into a field: Return or a
// blur keeps what was typed, Escape leaves it as it was.
function Named({
  title,
  onName,
}: {
  title: string;
  onName: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null)
    return (
      <button
        type="button"
        title="Rename"
        onClick={() => setDraft(title)}
        className="max-w-full truncate rounded px-1 text-left outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        {title}
      </button>
    );
  const keep = () => {
    const t = draft.trim();
    if (t && t !== title) onName(t);
    setDraft(null);
  };
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={keep}
      onKeyDown={(e) => {
        if (e.key === "Enter") keep();
        if (e.key === "Escape") setDraft(null);
      }}
      className="w-72 max-w-full rounded bg-transparent px-1 outline-none ring-2 ring-border-focus-ring"
    />
  );
}
