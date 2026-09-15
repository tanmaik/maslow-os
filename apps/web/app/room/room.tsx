"use client";

import { RiArrowLeftSLine, RiCloseLine, RiMoreLine } from "@remixicon/react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type TargetAndTransition,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { LiveBrowser } from "@/app/browser/live";
import { Finder } from "@/app/computer/files/finder";
import { Agent } from "@/app/computer/agent/agent";
import { Terminal } from "@/app/computer/terminal/terminal";
import {
  anotherOf,
  BLOCKS,
  boundsOf,
  boxOf,
  markOf,
  pathOf,
  type Bounds,
} from "@/app/room/blocks";
import { Arrival } from "@/app/room/arrival";
import type { State } from "@/lib/computer";
import { CommandBar } from "@/app/room/command";
import {
  Dock,
  DRAG,
  type Dragged,
  type Held,
  clearOf,
  type Side,
  useDockIconSize,
} from "@/app/room/dock";
import { MenuBar, type Me } from "@/app/room/menubar";
import { srcOf } from "@/app/room/wallpapers";
import { BarSlot } from "@/app/room/panel";
import { remember, rememberPaper, type Known } from "@/components/lock-screen";
import { Kbd } from "@/components/base/kbd/kbd";
import { Notification } from "@/components/base/notification/notification";
import {
  cascade,
  clamp,
  between,
  fit,
  fresh,
  type Box,
  type Card,
  type Desktop,
  type Port,
  type Screen,
} from "@/app/room/tiles";
import { BASE, FLIGHT } from "@/lib/motion";
import { cx } from "@/utils/cx";
import {
  getExitAnimation,
  TrafficLightButton,
  WindowFrameSnapZoneIndicator,
} from "@/app/room/window";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";

// Whether the dock hides when the hand leaves it, and whether its icons
// swell under the pointer, remembered on this device.
const HIDING = "maslow.dock.hiding";
const MAGNIFY = "maslow.dock.magnify";
const DOCK_SIDE = "maslow.dock.side";

// A point on the desk, as shares of its width and height.
type Point = { x: number; y: number };

const EMPTY: Screen = { cards: [] };

// The surfaces that are panels: drawn in the window itself, their
// controls in its bar, told which window on the desk they are and when it
// was just opened. Every other surface is framed as the page it is.
const PANELS: Record<
  string,
  ComponentType<{ fresh?: boolean; id?: string }>
> = {
  "/computer/agent": Agent,
  "/computer/terminal": Terminal,
  "/computer/files": Finder,
  "/browser": LiveBrowser,
};

// One page of the rail: the desk on a wide display, or one of its
// windows on a phone, where each window is a page of its own.
type Page = { key: string; cards: Card[] };

// Whether what is listening is what was listening, so a beat that finds
// nothing new leaves the dock alone.
const same = (a: Port[], b: Port[]) => JSON.stringify(a) === JSON.stringify(b);

// How many cards a desk holds at most, as the server keeps it.
const MOST = 32;

// How far past an edge still counts as meaning that edge.
const OVER = 0.08;

// How far a thumb travels before a drag on a phone's bar is a swipe.
const SWIPE = 48;

// Where a window goes when it is carried to a side of the desk: the side
// gives it that half, and either end of that side gives it the quarter
// there. How near counts is in the desk's own size, so it is the same
// reach on any screen; the ends are a long stretch, so a corner is as easy
// to mean as a side.
const SIDE = 0.06;
const END = 0.2;
// How much of the top edge, either side of its middle, fills the screen.
const MIDDLE = 0.12;
function landing(x: number, y: number): (Box & Point) | null {
  const l = x < SIDE;
  const r = x > 1 - SIDE;
  const u = y < SIDE;
  const d = y > 1 - SIDE;
  if (!l && !r && !u && !d) return null;
  if (l || r) {
    const top = y < END;
    const bottom = y > 1 - END;
    return {
      x: r ? 0.5 : 0,
      y: bottom ? 0.5 : 0,
      w: 0.5,
      h: top || bottom ? 0.5 : 1,
    };
  }
  const left = x < END;
  const right = x > 1 - END;
  if (left || right)
    return { x: right ? 0.5 : 0, y: d ? 0.5 : 0, w: 0.5, h: 0.5 };
  // The bottom is the half below it, all the way along.
  if (!u) return { x: 0, y: 0.5, w: 1, h: 0.5 };
  // The top reads as five: a quarter at either end, the half above along
  // most of it, and the whole desk in the middle, where a window carried
  // straight up is heading anyway. Which one it is, is drawn before it is
  // let go.
  return Math.abs(x - 0.5) < MIDDLE
    ? { x: 0, y: 0, w: 1, h: 1 }
    : { x: 0, y: 0, w: 1, h: 0.5 };
}

// The eight a keyboard can ask for by name, and the whole desk.
const PLACES: Record<string, Box & Point> = {
  left: { x: 0, y: 0, w: 0.5, h: 1 },
  right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  top: { x: 0, y: 0, w: 1, h: 0.5 },
  bottom: { x: 0, y: 0.5, w: 1, h: 0.5 },
  "top left": { x: 0, y: 0, w: 0.5, h: 0.5 },
  "top right": { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  "bottom left": { x: 0, y: 0.5, w: 0.5, h: 0.5 },
  "bottom right": { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
};

// The whole desk: what a window filling the screen is given, and what a
// window carried to the middle of the top edge lands on.
const WHOLE: Box & Point = { x: 0, y: 0, w: 1, h: 1 };

// What a key means, held with Control and Option: the arrows for the four
// sides and the keys under a right hand for the four corners. By the
// key's place, not its name: with Option held a Mac names a letter
// something else. Nothing here is a key a Mac or a browser keeps.
const ASKS: Record<string, string> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
  KeyU: "top left",
  KeyI: "top right",
  KeyJ: "bottom left",
  KeyK: "bottom right",
};

// A window's sides and corners, each a strip to take hold of: the corners
// wide enough to catch before the edges they sit between.
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
// Each strip straddles the frame, half in and half out, so a hand aiming
// at the edge from the desk catches it as readily as one aiming from
// inside the window.
const EDGES: [Edge, string][] = [
  ["n", "-top-1 right-4 left-4 h-2 cursor-ns-resize"],
  ["s", "-bottom-1 right-4 left-4 h-2 cursor-ns-resize"],
  ["w", "top-4 bottom-4 -left-1 w-2 cursor-ew-resize"],
  ["e", "top-4 -right-1 bottom-4 w-2 cursor-ew-resize"],
  ["nw", "-top-1 -left-1 size-4 cursor-nwse-resize"],
  ["ne", "-top-1 -right-1 size-4 cursor-nesw-resize"],
  ["sw", "-bottom-1 -left-1 size-4 cursor-nesw-resize"],
  ["se", "-right-1 -bottom-1 size-4 cursor-nwse-resize"],
];

export function Room({
  desktop,
  ports,
  you,
  computers,
  wallpaper,
  arrival,
  owed,
}: {
  desktop: Desktop;
  ports: Port[];
  // What this person's desk lies on, as they left it.
  wallpaper: string | null;
  you: (Me & Pick<Known, "picture">) | undefined;
  // Whether this deployment makes computers at all.
  computers: boolean;
  // Whether the card that meets a person on their first desk is still
  // to be answered.
  arrival: boolean;
  // Whether their computer is still owed what they said on that card.
  owed: boolean;
}) {
  const [arriving, setArriving] = useState(arrival);
  // While the card is up, and until the computer has what the person said
  // on it, the computer is asked after every few seconds: that is what
  // makes it, and what gives it the answer the moment it is ready. An
  // answer to an ask made before the card was answered says nothing
  // about what that answer owes, so asks are counted against answers.
  const [settling, setSettling] = useState(arrival || owed);
  const answered = useRef(0);
  const [making, setMaking] = useState<State | null>(null);
  // What went wrong giving the computer the person's answer, if anything
  // did; the asking goes on regardless.
  const [trouble, setTrouble] = useState<string | null>(null);
  useEffect(() => {
    if (!settling || !computers) return;
    let stopped = false;
    const ask = async () => {
      const before = answered.current;
      const res = await fetch("/computer/state", { method: "POST" }).catch(
        () => null,
      );
      if (stopped) return;
      if (!res?.ok) return setTrouble("Maslow did not answer just now.");
      const s = (await res.json().catch(() => null)) as
        (State & { owed: boolean; trouble: string | null }) | null;
      if (!s || stopped) return;
      setMaking(s);
      setTrouble(s.trouble ?? s.failed);
      if (s.progress === "ready" && !s.owed && before === answered.current)
        setSettling(false);
    };
    const beat = setInterval(() => void ask(), 4000);
    void ask();
    return () => {
      stopped = true;
      clearInterval(beat);
    };
  }, [settling, computers]);
  const [screen, setScreenState] = useState<Screen>(desktop.layout ?? EMPTY);
  // The wallpaper the desk wears.
  const [paper, setPaper] = useState<string | null>(wallpaper);
  // What this device keeps of the desk, for the lock screen to wear and to
  // greet whoever signs in next by: the wallpaper, and who was here.
  useEffect(() => rememberPaper(paper), [paper]);
  useEffect(() => {
    if (you)
      remember({ email: you.email, name: you.name, picture: you.picture });
  }, [you?.email, you?.name, you?.picture]);
  // What is listening, kept current while the room is open. Nothing is
  // asked while the tab is not being looked at.
  const [live, setLive] = useState(ports);
  // The command bar: open or not, and what was typed to open it.
  const [bar, setBar] = useState({ open: false, initial: "" });
  // A phone's window menu, opened from the name in the bar. What it offers
  // is done and the sheet is gone in the same breath.
  const [menu, setMenu] = useState(false);
  const act = (fn: () => void) => {
    setMenu(false);
    fn();
  };
  // Counted up on every look, so what is watching knows a look happened
  // even when nothing about the ports changed.
  const [looks, setLooks] = useState(0);
  useEffect(() => {
    let stopped = false;
    let asking = false;
    const ask = async () => {
      if (document.hidden || asking) return;
      asking = true;
      try {
        const res = await fetch("/room/ports").catch(() => null);
        // A session that has ended will not begin again by asking.
        if (res?.status === 401) return void (stopped = true);
        if (stopped || !res?.ok) return;
        const now = (await res.json().catch(() => null)) as {
          // Null while the computer is not answering.
          ports: Port[] | null;
          rev: number;
        } | null;
        if (now && !stopped) {
          if (now.ports) {
            const ports = now.ports;
            setLive((was) => (same(was, ports) ? was : ports));
            setLooks((n) => n + 1);
          }
          // The desk kept elsewhere since this page saw it, a widget the
          // agent placed most often, is taken in.
          // Not while a save of this page's own is out: its answer says
          // where the desk stands, and the next ask is seconds away.
          if (now.rev > rev.current && saving.current === 0) {
            const desk = await fetch("/room/desktop").catch(() => null);
            const got = desk?.ok
              ? ((await desk.json().catch(() => null)) as Desktop | null)
              : null;
            // Asked again once the desk is here: a save may have gone
            // out while it was on its way.
            if (got && !stopped && saving.current === 0) take(got);
          }
        }
      } finally {
        asking = false;
      }
    };
    // Asked every few seconds, and every second while a window is showing
    // a port that has stopped, so a restart is over before it is noticed.
    const soon = () => {
      clearTimeout(beat);
      if (!stopped) beat = setTimeout(look, doubted.current.size ? 1000 : 5000);
    };
    const look = () => void ask().finally(soon);
    let beat: ReturnType<typeof setTimeout>;
    document.addEventListener("visibilitychange", look);
    look();
    return () => {
      stopped = true;
      clearTimeout(beat);
      document.removeEventListener("visibilitychange", look);
    };
  }, []);
  // How many looks in a row a window's port has not been listening. A
  // restart is a port stopping, so one is given a moment to come back.
  const doubted = useRef(new Map<string, number>());
  const GONE = 3;
  // What each port window has been told to load, raised when its port
  // comes back so the frame fetches it again rather than sitting on a page
  // that is no longer being served.
  const [afresh, setAfresh] = useState<Record<string, number>>({});
  // A window is worth keeping only while what it shows is still there.
  useEffect(() => {
    const serving = new Set(live.map((x) => x.href));
    for (const c of screen.cards) {
      if (c.kind !== "port") continue;
      const missed = doubted.current.get(c.id) ?? 0;
      if (serving.has(c.href)) {
        if (!missed) continue;
        doubted.current.delete(c.id);
        setAfresh((was) => ({ ...was, [c.id]: (was[c.id] ?? 0) + 1 }));
      } else if (missed + 1 >= GONE) {
        doubted.current.delete(c.id);
        void close(c.id);
      } else {
        doubted.current.set(c.id, missed + 1);
      }
    }
  }, [looks]);

  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  // A block picked from the toolbar, waiting to be put down where the
  // person clicks.
  const carrying = useRef<Dragged | null>(null);
  // While anything is dragged, the windows' frames stop taking the
  // pointer: a frame would swallow the drag as its own.
  const [carried, setCarried] = useState(false);
  const [preview, setPreview] = useState<Point | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();

  // Whether the dock hides when the hand leaves it. Hidden, the desk
  // takes the whole page.
  const [hiding, setHiding] = useState(false);
  useEffect(() => {
    setHiding(localStorage.getItem(HIDING) === "yes");
  }, []);
  const hide = (to: boolean) => {
    setHiding(to);
    localStorage.setItem(HIDING, to ? "yes" : "no");
  };
  const [magnify, setMagnify] = useState(true);
  useEffect(() => {
    setMagnify(localStorage.getItem(MAGNIFY) !== "no");
  }, []);
  const swell = (to: boolean) => {
    setMagnify(to);
    localStorage.setItem(MAGNIFY, to ? "yes" : "no");
  };
  const [side, setSide] = useState<Side>("bottom");
  useEffect(() => {
    const kept = localStorage.getItem(DOCK_SIDE);
    if (kept === "left" || kept === "right") setSide(kept);
  }, []);
  const place = (to: Side) => {
    setSide(to);
    localStorage.setItem(DOCK_SIDE, to);
  };
  // A dock setting changed in Settings, in its own window, reaches the
  // desk at once: the device's store says so.
  useEffect(() => {
    const heard = (e: StorageEvent) => {
      if (e.key === HIDING || e.key === null)
        setHiding(localStorage.getItem(HIDING) === "yes");
      if (e.key === MAGNIFY || e.key === null)
        setMagnify(localStorage.getItem(MAGNIFY) !== "no");
      if (e.key === DOCK_SIDE || e.key === null) {
        const kept = localStorage.getItem(DOCK_SIDE);
        setSide(kept === "left" || kept === "right" ? kept : "bottom");
      }
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  }, []);
  // The windows opened from the dock this session, which arrive out of
  // their block's icon.
  const born = useRef(new Set<string>());

  const [wide, setWide] = useState(true);
  useEffect(() => {
    const q = matchMedia("(min-width: 640px)");
    const read = () => setWide(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);
  // The edge the dock lies along, for the desk to keep clear of: none
  // while it hides, and a phone's is always the bottom.
  const away: Side | null = hiding ? null : wide ? side : "bottom";

  // Escape brings an expanded window back down.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setExpanded(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // Every window, open or put away.
  const held: Held[] = screen.cards.map((card) => ({
    screen: desktop.id,
    card,
  }));

  // The windows, as the dock and the menu bar list them: a widget is
  // neither open nor put away, it is part of the desk.
  const windows = held.filter((w) => !w.card.pinned);
  const out = screen.cards.filter((c) => !c.stowed && !c.pinned);
  const pages: Page[] =
    wide || out.length === 0
      ? [{ key: desktop.id, cards: wide ? screen.cards : out }]
      : out.map((c) => ({ key: `${desktop.id}:${c.id}`, cards: [c] }));

  // A window just opened, waiting for its page to exist.
  const [opened, setOpened] = useState<string | null>(null);
  // A window brought to the front, out of the dock if it was put away,
  // and on a phone the rail taken to it.
  const raise = (w: Held) => {
    if (w.card.pinned) return;
    setScreen((l) => {
      const c = l.cards.find((x) => x.id === w.card.id);
      if (!c) return null;
      // On a phone a window is a page, and the pages stand in the order
      // they were opened: going to one never moves the rest under the
      // thumb. On a desk, coming forward is coming to the top of the pile.
      return wide
        ? {
            cards: [
              ...l.cards.filter((x) => x.id !== w.card.id),
              { ...c, stowed: false },
            ],
          }
        : {
            cards: l.cards.map((x) =>
              x.id === w.card.id ? { ...x, stowed: false } : x,
            ),
          };
    });
    if (!wide) setOpened(`${w.screen}:${w.card.id}`);
  };
  // The rail taken to a window the moment its page exists, and not before.
  useEffect(() => {
    if (!opened) return;
    if (!pages.some((p) => p.key === opened)) return;
    setOpened(null);
    requestAnimationFrame(() =>
      rail.current
        ?.querySelector(`[data-page="${CSS.escape(opened)}"]`)
        ?.scrollIntoView({ inline: "start", block: "nearest" }),
    );
  }, [opened, pages]);

  // Which page is in view, from how far the rail has been swiped.
  const track = () => {
    const el = rail.current;
    if (!el) return;
    setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goTo = (i: number) =>
    rail.current?.scrollTo({
      left: i * rail.current.clientWidth,
      behavior: still ? "auto" : "smooth",
    });

  // How many times the desk has been kept, as this page last saw it. A
  // save names it; one that fell behind is refused, and the desk as it now
  // is comes back to be taken in, this page's own changes kept over it.
  const rev = useRef(desktop.rev);
  // The desk as this page last knew it kept, which its own changes since
  // are measured against when a desk kept elsewhere is taken in.
  const known = useRef<Screen>(desktop.layout ?? EMPTY);
  // Saves go one after another, each carrying the desk as it is when its
  // turn comes, so a later change is never written over by an earlier
  // save's answer.
  const saves = useRef(Promise.resolve());
  // How many saves are out, since a desk taken in while one is would
  // mistake what it saved for a change still to make.
  const saving = useRef(0);
  const persist = () => {
    saving.current += 1;
    saves.current = saves.current.then(async () => {
      const layout = latest.current;
      const res = await fetch("/room/desktop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: desktop.id, layout, rev: rev.current }),
      }).catch(() => null);
      if (!res || (!res.ok && res.status !== 409)) return;
      const got = (await res.json().catch(() => null)) as Desktop | null;
      if (!got) return;
      if (res.ok) {
        if (got.rev > rev.current) {
          rev.current = got.rev;
          known.current = layout;
        }
        for (const c of layout.cards) unsaved.current.delete(c.id);
      } else take(got, true);
    });
    void saves.current.finally(() => (saving.current -= 1));
  };
  // The desk as it is this moment, for a change made from a pointer
  // handler that closed over an earlier render; kept once, sent once.
  const latest = useRef(screen);
  latest.current = screen;
  // The cards a pointer is moving or resizing this moment, whose place on
  // this page is truer than any kept elsewhere.
  const gripped = useRef(new Set<string>());
  // The cards this page has changed or opened whose save has not landed.
  const unsaved = useRef(new Set<string>());
  // The desk as it was kept elsewhere, taken in: what it holds is what
  // stays, except what this page changed since it last knew the desk
  // kept, which is kept over it: a card added, a card taken away, a card
  // moved, a card under the pointer, and the order this page's windows
  // stack in. What the desk was kept as stays the measure until a save of
  // this page's own lands. A save refused for falling behind takes the
  // desk in and keeps it again.
  const take = (got: Desktop, again = false) => {
    // A desk older than the one this page already has is a late answer;
    // a save refused on it is still owed, against the desk as it is now.
    if (got.rev < rev.current) {
      if (again) persist();
      return;
    }
    rev.current = got.rev;
    const theirs = got.layout?.cards ?? [];
    const mine = latest.current.cards;
    const base = known.current.cards;
    // The same card however its fields are ordered, since the database
    // keeps them in an order of its own.
    const canon = (c: Card) =>
      JSON.stringify(Object.fromEntries(Object.entries(c).sort()));
    const same = (a: Card, b: Card) => canon(a) === canon(b);
    const keep = (id: string): Card | null => {
      const t = theirs.find((c) => c.id === id);
      const m = mine.find((c) => c.id === id);
      const b = base.find((c) => c.id === id);
      // Changed here since: this page's version. Taken away here: gone.
      // Taken away elsewhere while its panel has a question to ask
      // before it goes: it stays until the question is answered, and
      // goes then.
      if (m && !t && b && asking.current.has(id) && !unsaved.current.has(id))
        void close(id);
      // Made to show something else elsewhere while its panel has a
      // question to ask: it keeps showing what it does until the answer,
      // and shows the new thing then, if the answer allows.
      const ask = asking.current.get(id);
      if (m && t && b && t.href !== m.href && ask && !unsaved.current.has(id)) {
        unsaved.current.add(id);
        void ask().then((allowed) => {
          if (!allowed) return;
          asking.current.delete(id);
          unsaved.current.delete(id);
          setScreen((l) => ({
            cards: l.cards.map((c) => (c.id === id ? t : c)),
          }));
        });
        return m;
      }
      if (
        m &&
        (gripped.current.has(id) ||
          (b ? !same(m, b) : unsaved.current.has(id)) ||
          (!t && asking.current.has(id)))
      ) {
        // Kept over the desk as kept, it is a change still to save, and
        // stays one through every desk taken in until it lands.
        unsaved.current.add(id);
        return m;
      }
      if (!m && b) return null;
      return t ?? null;
    };
    // This page's cards in this page's order, then what arrived from
    // elsewhere; what this page took away since is not back because the
    // desk kept elsewhere still had it. Every widget lies under every
    // window, each group in its own order. A desk is only so big: past
    // its most, what arrived last is left off, since a desk the server
    // would refuse could never be kept again.
    const ours = new Set(mine.map((c) => c.id));
    const gone = new Set(base.map((c) => c.id));
    const stayed = mine
      .map((c) => keep(c.id))
      .filter((c): c is Card => c !== null);
    const arrived = theirs
      .filter((c) => !ours.has(c.id) && !gone.has(c.id))
      .slice(0, Math.max(0, MOST - stayed.length));
    const met = [...stayed, ...arrived];
    const cards = [
      ...met.filter((c) => c.pinned),
      ...met.filter((c) => !c.pinned),
    ];
    known.current = got.layout ?? EMPTY;
    setScreen(() => ({ cards }), again);
  };
  const setScreen = (to: (layout: Screen) => Screen | null, save = true) => {
    const layout = to(latest.current);
    if (!layout) return;
    latest.current = layout;
    setScreenState(layout);
    if (save) persist();
  };

  // A block landing on the desk: a new window at the block's own size,
  // where the person pointed or where a cascade puts it, in front of the
  // rest. The same block may be open as many times as they like; each
  // window after the first is numbered, so every one can be told apart.
  const land = (
    item: Dragged,
    at?: Point & Partial<Box>,
    pinned = false,
  ): Card | null => {
    const open = (cards: Card[]): Card => {
      const id = fresh();
      born.current.add(id);
      unsaved.current.add(id);
      const same = cards.filter(
        (c) => pathOf(c.href) === pathOf(item.href),
      ).length;
      return clamp({
        id,
        kind: item.kind,
        title: same ? `${item.title} ${same + 1}` : item.title,
        href: item.href,
        ...item.box,
        ...(at ?? cascade(cards, item.box)),
        ...(pinned ? { pinned } : {}),
      });
    };
    let made: Card | null = null;
    // A widget lies on the desk, under every window: first in the stack.
    setScreen((l) => {
      made = open(l.cards);
      return { cards: pinned ? [made, ...l.cards] : [...l.cards, made] };
    });
    return made;
  };
  // A port put on the desk as a widget, laid from the far corner inward:
  // the near corner is where the next window will cascade to.
  const pin = (item: Dragged) => {
    const n = latest.current.cards.filter((c) => c.pinned).length;
    return land(
      item,
      {
        x: 1 - item.box.w - 0.02 - 0.02 * n,
        y: 1 - item.box.h - 0.03 - 0.03 * n,
      },
      true,
    );
  };

  // What a panel wants asked before its window goes: an edit not saved,
  // and nothing else the room could know about.
  const asking = useRef(new Map<string, () => Promise<boolean>>());
  const guard = useCallback(
    (key: string, ask: (() => Promise<boolean>) | null) => {
      if (ask) asking.current.set(key, ask);
      else asking.current.delete(key);
    },
    [],
  );

  const close = async (key: string) => {
    const ask = asking.current.get(key);
    if (ask && !(await ask())) return;
    asking.current.delete(key);
    setExpanded((e) => (e === key ? null : e));
    setScreen((l) => ({ cards: l.cards.filter((c) => c.id !== key) }));
  };

  // A window changed by hand: moved or resized, live while the pointer is
  // down and kept when it lifts.
  const shape = (key: string, to: Partial<Card>, save: boolean) => {
    if (save) gripped.current.delete(key);
    else gripped.current.add(key);
    setScreen(
      (l) => ({
        cards: l.cards.map((c) => (c.id === key ? clamp({ ...c, ...to }) : c)),
      }),
      save,
    );
  };

  // A window touched comes to the front.
  // A widget stays under the windows however it is touched.
  const front = (key: string) =>
    setScreen((l) => {
      if (l.cards.at(-1)?.id === key) return null;
      const c = l.cards.find((x) => x.id === key);
      return c && !c.pinned
        ? { cards: [...l.cards.filter((x) => x.id !== key), c] }
        : null;
    });

  // A widget made a window again: it stops lying under the others and
  // comes to the front. One change, so one save: two would race, and the
  // stale one would win.
  const unpin = (key: string) =>
    setScreen((l) => {
      const c = l.cards.find((x) => x.id === key);
      return c
        ? {
            cards: [
              ...l.cards.filter((x) => x.id !== key),
              clamp({ ...c, pinned: false }),
            ],
          }
        : null;
    });

  const begin = (item: Dragged) => (e: DragEvent) => {
    carrying.current = item;
    e.dataTransfer.setData(DRAG, JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
    setCarried(true);
  };
  const end = () => {
    carrying.current = null;
    setCarried(false);
    setPreview(null);
  };

  // A block picked from the dock opens on the desk, and on a phone, where
  // a window is a page of its own, the rail goes to it: one opened out of
  // sight is one that did not seem to open at all.
  const pick = (b: Dragged) => {
    const made = land(b);
    if (!wide && made) setOpened(`${desktop.id}:${made.id}`);
  };
  // An app as the dock opens it: its last window forward, or a first one.
  const open = (b: Dragged) => {
    const last = windows
      .filter((w) => pathOf(w.card.href) === pathOf(b.href))
      .at(-1);
    if (last) raise(last);
    else pick(b);
  };
  // Settings, on a pane if one is asked for, at one of its sections if a
  // section is: the Settings window already open, brought forward and
  // turned to that pane, or a first one.
  const settings = (pane?: string, section?: string) => {
    const href = pane
      ? `/settings?pane=${pane}${section ? `#${section}` : ""}`
      : "/settings";
    const had = windows
      .filter((w) => pathOf(w.card.href) === "/settings")
      .at(-1);
    if (had) {
      raise(had);
      if (pane) shape(had.card.id, { href }, true);
      return;
    }
    pick({
      kind: "settings",
      title: "Settings",
      href,
      box: boxOf({ kind: "settings", href: "/settings" }),
    });
  };
  // A record, in the Brain window already open turned to it, or a first
  // one: one Brain at a time, as Settings is one Settings at a time.
  const brain = (href: string, title: string) => {
    const had = windows
      .filter((w) => pathOf(w.card.href).startsWith("/brain"))
      .at(-1);
    if (had) {
      raise(had);
      shape(had.card.id, { href, title }, true);
      return;
    }
    pick({ kind: "record", title, href, box: boxOf({ kind: "record", href }) });
  };
  // A port of the person's own that the computer asked the desk to open:
  // the window already showing it comes forward, or a first one opens.
  // A server started a moment ago is not in the list until the next look,
  // so the ask waits for it rather than being lost.
  const awaited = useRef<{ port: number; until: number } | null>(null);
  const portNamed = (n: number) =>
    live.find((x) => x.href.split("/").at(-1) === String(n));
  const show = (it: Port) =>
    open({
      kind: "port",
      title: it.title,
      href: it.href,
      box: boxOf({ kind: "port", href: it.href }),
    });
  const openPort = (n: number) => {
    const it = portNamed(n);
    if (it) show(it);
    else awaited.current = { port: n, until: Date.now() + 30_000 };
  };
  useEffect(() => {
    const want = awaited.current;
    if (!want) return;
    if (Date.now() > want.until) return void (awaited.current = null);
    const it = portNamed(want.port);
    if (!it) return;
    awaited.current = null;
    show(it);
  }, [looks]);
  // A file or folder of theirs, named as their home has it: Files, at
  // that folder, with the file picked.
  const openFile = (path: string) =>
    pick({
      kind: "page",
      title: path.split("/").filter(Boolean).at(-1) ?? "Files",
      href: `/computer/files?path=${encodeURIComponent(path)}`,
      box: boxOf({ kind: "page", href: "/computer/files" }),
    });

  // The next window forward, or the front one to the back.
  const cycle = (back: boolean) =>
    setScreen((l) => {
      const up = l.cards.filter((c) => !c.stowed && !c.pinned);
      if (up.length < 2) return null;
      const rest = l.cards.filter((c) => c.stowed || c.pinned);
      const order = back
        ? [...up.slice(-1), ...up.slice(0, -1)]
        : [...up.slice(1), up[0]!];
      return {
        cards: [
          ...rest.filter((c) => c.pinned),
          ...order,
          ...rest.filter((c) => c.stowed),
        ],
      };
    });

  // The window in front on the page being looked at.
  const page = pages[Math.min(current, pages.length - 1)];
  const top = page?.cards.filter((c) => !c.stowed && !c.pinned).at(-1);
  const atFront: Held | null = top ? { screen: desktop.id, card: top } : null;
  // What the desk answers to. Command-K opens the bar from anywhere in
  // the room; a plain letter typed with nothing focused opens it with
  // that letter; Control and Option with a letter or an arrow acts on the
  // window in front, putting it on a side, a corner or the whole desk.
  // Nothing fires while a field, a menu or a framed page has the keys,
  // and no key is taken that is not acted on.
  useEffect(() => {
    const busy = (t: EventTarget | null) =>
      t instanceof Element &&
      (t.closest(
        "input, textarea, select, [contenteditable], [role=menu], [role=menuitem], [role=dialog], iframe",
      ) !== null ||
        (t as HTMLElement).isContentEditable);
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        if (busy(e.target) && !bar.open) return;
        e.preventDefault();
        setBar({ open: true, initial: "" });
        return;
      }
      if (busy(e.target) || document.querySelector("[role=menu]")) return;
      if (e.ctrlKey && e.altKey && !e.metaKey) {
        // By the key's place, not its name: with Option held a Mac
        // names the letter something else.
        const k = e.code;
        const front = top ?? null;
        if (k === "KeyN") {
          e.preventDefault();
          const b = BLOCKS.find((x) => x.href === "/computer/terminal")!;
          const { mark: _mark, ...terminal } = b;
          pick(front ? anotherOf(front) : terminal);
        } else if (k === "KeyW" && front) {
          e.preventDefault();
          void close(front.id);
        } else if (k === "KeyM" && front) {
          e.preventDefault();
          shape(front.id, { stowed: true }, true);
        } else if (k === "Tab") {
          e.preventDefault();
          cycle(e.shiftKey);
        } else if (k === "Comma") {
          e.preventDefault();
          settings();
        } else if (k === "Enter" && front) {
          e.preventDefault();
          setExpanded((was) => (was === front.id ? null : front.id));
        } else {
          const place = PLACES[ASKS[k] ?? ""];
          if (place && front) {
            e.preventDefault();
            shape(front.id, place, true);
          }
        }
        return;
      }
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.length === 1 &&
        (document.activeElement === null ||
          document.activeElement === document.body)
      ) {
        e.preventDefault();
        setBar({ open: true, initial: e.key });
      }
    };
    // A framed page asks the same of the room with Command-K.
    const said = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const asked = e.data as {
        maslow?: string;
        choice?: unknown;
        href?: unknown;
        title?: unknown;
        port?: unknown;
        path?: unknown;
      };
      if (asked?.maslow === "command") setBar({ open: true, initial: "" });
      // A record named anywhere on the desk — the menu bar's notices, a
      // framed page — opened in the Brain window.
      if (
        asked?.maslow === "record" &&
        typeof asked.href === "string" &&
        typeof asked.title === "string"
      )
        brain(asked.href, asked.title);
      // A wallpaper picked in a Settings window is worn by the desk at once.
      if (asked?.maslow === "wallpaper" && typeof asked.choice === "string")
        setPaper(asked.choice);
      // Something a program on the computer asked to open: a port of
      // theirs, which is a window on the desk, or a file of theirs, which
      // is Files at its folder.
      if (asked?.maslow === "open") {
        if (typeof asked.port === "number") openPort(asked.port);
        else if (typeof asked.path === "string") openFile(asked.path);
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("message", said);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("message", said);
    };
  });

  // A two-finger tap opens the command bar, for a hand with no key to
  // press: two fingers down and lifted quickly, without spreading, count;
  // anything longer or wider is a pinch or a two-finger scroll and means
  // nothing here.
  useEffect(() => {
    let began: { at: number; x: number; y: number } | null = null;
    let spread = false;
    const mid = (t: TouchList) => ({
      x: (t[0]!.clientX + t[1]!.clientX) / 2,
      y: (t[0]!.clientY + t[1]!.clientY) / 2,
    });
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        began = null;
        return;
      }
      spread = false;
      began = { at: Date.now(), ...mid(e.touches) };
    };
    const move = (e: TouchEvent) => {
      if (!began || e.touches.length !== 2) return;
      const now = mid(e.touches);
      if (Math.hypot(now.x - began.x, now.y - began.y) > 10) spread = true;
    };
    const end = (e: TouchEvent) => {
      if (!began || e.touches.length !== 0) return;
      const quick = Date.now() - began.at < 300;
      began = null;
      if (quick && !spread) setBar({ open: true, initial: "" });
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
  }, []);

  return (
    <>
      <Wallpaper choice={paper} />
      <MenuBar
        you={you}
        computers={computers}
        front={atFront}
        open={windows}
        onPick={pick}
        onFront={raise}
        onStow={(w) => shape(w.card.id, { stowed: true }, true)}
        onFill={(w) => setExpanded(w.card.id)}
        onClose={(w) => void close(w.card.id)}
        onSearch={() => setBar({ open: true, initial: "" })}
        onCycle={cycle}
        onSnap={(place) => top && shape(top.id, PLACES[place]!, true)}
        onSettings={settings}
      />
      {trouble && (
        <div className="fixed top-12 right-4 z-50 max-w-sm">
          <Notification
            status="error"
            title="Your computer is not ready yet"
            description={`${trouble} Trying again.`}
            dismissible={false}
          />
        </div>
      )}
      {arriving && (
        <Arrival
          computer={computers ? (making?.progress ?? null) : "off"}
          onDone={() => {
            answered.current += 1;
            setArriving(false);
            setSettling(true);
          }}
        />
      )}
      <CommandBar
        open={bar.open}
        initial={bar.initial}
        onOpenChange={(o) => setBar((b) => ({ ...b, open: o }))}
        windows={windows}
        ports={live}
        onApp={open}
        onNewApp={pick}
        onWindow={raise}
        onPort={pick}
        onPin={pin}
        onPane={settings}
        onRecord={(id, title) => brain(`/brain/records/${id}`, title)}
        onFile={(path, name) =>
          pick({
            kind: "page",
            title: name,
            href: `/computer/files?path=${encodeURIComponent(path)}`,
            box: boxOf({ kind: "page", href: "/computer/files" }),
          })
        }
      />
      <div
        ref={rail}
        onScroll={track}
        className={`fixed inset-0 z-10 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          carried ? "[&_iframe]:pointer-events-none" : ""
        }`}
      >
        {pages.map((p, i) => (
          <Desk
            key={p.key}
            page={p}
            index={i}
            count={pages.length}
            current={current}
            onGo={goTo}
            onMenu={() => setMenu(true)}
            wide={wide}
            away={away}
            computers={computers}
            carried={carried}
            carrying={carrying}
            preview={preview}
            expanded={expanded}
            afresh={afresh}
            born={born.current}
            onHover={setPreview}
            onDrop={(at) => {
              const item = carrying.current;
              end();
              if (item) land(item, at);
            }}
            onClose={(key) => void close(key)}
            onGuard={guard}
            onShape={shape}
            onFront={front}
            onUnpin={unpin}
            onCarry={setCarried}
            onExpand={setExpanded}
            onCollapse={() => setExpanded(null)}
            onSettings={settings}
            onSearch={() => setBar({ open: true, initial: "" })}
            onWallpaper={() => settings("look", "wallpaper")}
          />
        ))}
      </div>

      {/* A phone's window bar folds the front window's menu and the Window
          menu under its name: a tap there opens both as one sheet. */}
      {!wide && (
        <PhoneSheet
          open={menu}
          onClose={() => setMenu(false)}
          label={atFront?.card.title ?? "Windows"}
        >
          {atFront && (
            <>
              <SheetRow
                onClick={() => act(() => pick(anotherOf(atFront.card)))}
              >
                New window
              </SheetRow>
              <SheetRow
                onClick={() =>
                  act(() => shape(atFront.card.id, { stowed: true }, true))
                }
              >
                Put away
              </SheetRow>
              <SheetRow onClick={() => act(() => void close(atFront.card.id))}>
                Close
              </SheetRow>
            </>
          )}
          {windows.length > 0 && (
            <>
              <div className="bg-separator-border my-2 h-px" />
              {windows.map((w) => (
                <SheetRow
                  key={w.card.id}
                  current={w.card.id === atFront?.card.id}
                  onClick={() => act(() => raise(w))}
                >
                  {w.card.stowed ? `${w.card.title} (put away)` : w.card.title}
                </SheetRow>
              ))}
            </>
          )}
        </PhoneSheet>
      )}
      <Dock
        wide={wide}
        onStow={(w) => shape(w.card.id, { stowed: true }, true)}
        hiding={hiding}
        magnify={magnify}
        side={wide ? side : "bottom"}
        onHiding={hide}
        onMagnify={swell}
        onSide={place}
        ports={live}
        held={windows}
        onPin={pin}
        onBegin={begin}
        onEnd={end}
        onPick={pick}
        onFront={raise}
        onClose={(w) => void close(w.card.id)}
      />
    </>
  );
}

// How long a wallpaper takes to arrive over the one before it: the twin
// of --transition-duration-slow, which draws the fade.
const FADE = 300;

// What the desk sits on: the picture the person chose, over the bare warm
// ground, which is what is left when there is no picture or when one will
// not load. Two layers, so a new one fades in rather than cuts. The top is
// darkened so the menu bar's words read against it whatever the picture
// is; the darkening is the wallpaper's, not the bar's: the bar itself is
// nothing but its words.
function Wallpaper({ choice }: { choice: string | null }) {
  const still = useReducedMotion();
  // A picture that would not load is not asked for again.
  const [broken, setBroken] = useState<string[]>([]);
  const asked = srcOf(choice);
  const want = asked && broken.includes(asked) ? null : asked;
  const [shown, setShown] = useState<string | null>(want);
  // The one arriving over it, while it arrives; nothing at rest.
  const [arriving, setArriving] = useState<{ src: string | null } | null>(null);
  const [lit, setLit] = useState(false);

  useEffect(() => {
    if (want === shown) {
      setArriving(null);
      return;
    }
    setArriving({ src: want });
    setLit(false);
    const frame = requestAnimationFrame(() => setLit(true));
    const done = setTimeout(
      () => {
        setShown(want);
        setArriving(null);
      },
      still ? 0 : FADE,
    );
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [want, shown, still]);

  const layer = (src: string | null) =>
    src && (
      <img
        src={src}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover"
        onError={() => setBroken((was) => [...was, src])}
      />
    );

  return (
    <div className="fixed inset-0 bg-canvas">
      {layer(shown)}
      {arriving && (
        <div
          className={cx(
            "absolute inset-0 bg-canvas transition-opacity duration-slow ease-out-quart",
            lit ? "opacity-100" : "opacity-0",
          )}
        >
          {layer(arriving.src)}
        </div>
      )}
      {/* Deep enough that the bar's white words clear 4.5:1 over anything
          a desk can wear, a picture the person uploaded included: at its
          lightest the ground under the bar is a white wallpaper through
          this scrim, which is 7.2:1 at the top of the bar and 5.0:1 at
          the bottom of it. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[140px]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.68), rgba(0,0,0,0))",
        }}
      />
    </div>
  );
}

// One page of the rail: a desk with its windows where they were left, the
// spot a drag would land, and the desk's own menu on
// a right-click or a long press.
function Desk({
  page,
  index,
  count,
  current,
  onGo,
  onMenu,
  wide,
  away,
  computers,
  carried,
  carrying,
  preview,
  expanded,
  afresh,
  born,
  onHover,
  onDrop,
  onClose,
  onGuard,
  onShape,
  onFront,
  onUnpin,
  onCarry,
  onExpand,
  onCollapse,
  onSettings,
  onSearch,
  onWallpaper,
}: {
  page: Page;
  // Which page of the rail this is, how many there are, and the way to
  // another: on a phone one window is one page.
  index: number;
  count: number;
  // Which page the rail is on, which every page's dots mark.
  current: number;
  onGo: (i: number) => void;
  // A phone's window menu, opened from the name in its bar.
  onMenu: () => void;
  wide: boolean;
  // Whether the desk keeps clear of the dock.
  away: Side | null;
  computers: boolean;
  carried: boolean;
  carrying: React.RefObject<Dragged | null>;
  preview: Point | null;
  expanded: string | null;
  afresh: Record<string, number>;
  // The windows opened from the dock this session.
  born: Set<string>;
  onHover: (at: Point | null) => void;
  onDrop: (at: Point & Partial<Box>) => void;
  onClose: (key: string) => void;
  // Where a panel leaves the question its window must ask before it goes.
  onGuard: (key: string, ask: (() => Promise<boolean>) | null) => void;
  onShape: (key: string, to: Partial<Card>, save: boolean) => void;
  onFront: (key: string) => void;
  // A widget made a window again: unpinned and raised in one change.
  onUnpin: (key: string) => void;
  onCarry: (carrying: boolean) => void;
  onExpand: (key: string) => void;
  onCollapse: () => void;
  onSettings: () => void;
  onSearch: () => void;
  onWallpaper: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  // What the dock takes on its edge, measured from the icon size the
  // person set, so a filled window stops exactly where the shelf starts.
  const clear = clearOf(useDockIconSize());
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // A point on the desk under a point on the screen.
  const pointAt = (clientX: number, clientY: number): Point | null => {
    const el = box.current;
    if (!el || size.w <= 0) return null;
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left) / size.w;
    const y = (clientY - r.top) / size.h;
    // A hand aiming at an edge overshoots it, and means the edge; a hand a
    // long way outside means nowhere.
    if (x < -OVER || x > 1 + OVER || y < -OVER || y > 1 + OVER) return null;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };
  // Where something sits on the desk, in pixels: its share of the desk,
  // held to the sizes its surface is worth being.
  const rectOf = (c: Box & Point, bounds?: Bounds) => {
    const it = fit(c, size, bounds);
    return {
      left: it.x * size.w,
      top: it.y * size.h,
      width: it.w * size.w,
      height: it.h * size.h,
    };
  };

  // Where a window carried by its bar would land, while it is held, and
  // the sizes it will be held to there.
  const [zone, setZone] = useState<{
    at: Box & Point;
    bounds: Bounds;
  } | null>(null);
  // What is being carried, drawn where letting go would put it: the half
  // or quarter it is over, or its own size where it is held.
  const ghost = zone
    ? rectOf(zone.at, zone.bounds)
    : preview && carrying.current
      ? rectOf(
          clamp({
            ...carrying.current.box,
            ...(landing(preview.x, preview.y) ?? preview),
          }),
          boundsOf(carrying.current),
        )
      : null;
  // The glow, in the screen's own coordinates, since it is drawn over
  // everything.
  const glow = () => {
    const r = box.current?.getBoundingClientRect();
    return ghost && r
      ? {
          top: r.top + ghost.top,
          left: r.left + ghost.left,
          width: ghost.width,
          height: ghost.height,
        }
      : null;
  };
  // Where a window's middle is on the screen, for its flight to the dock
  // and back.
  const middle = (c: Card) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    return wide
      ? {
          x: r.left + (c.x + c.w / 2) * size.w,
          y: r.top + (c.y + c.h / 2) * size.h,
        }
      : { x: r.left + size.w / 2, y: r.top + size.h / 2 };
  };

  return (
    <div
      data-page={page.key}
      className="relative h-full w-full shrink-0 snap-start"
      onDragOver={(e) => {
        if (!carrying.current || !wide) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onHover(pointAt(e.clientX, e.clientY));
      }}
      onDragLeave={(e) => {
        if (!box.current?.contains(e.relatedTarget as globalThis.Node))
          onHover(null);
      }}
      onDrop={(e) => {
        if (!carrying.current || !wide) return;
        e.preventDefault();
        const at = preview ?? pointAt(e.clientX, e.clientY);
        if (at) onDrop(landing(at.x, at.y) ?? at);
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger className="absolute inset-0" />
        <ContextMenuContent>
          <ContextMenuItem onClick={onSearch}>
            Find…
            <Kbd className="ml-auto">⌘K</Kbd>
          </ContextMenuItem>
          <ContextMenuItem onClick={onWallpaper}>
            Change wallpaper…
          </ContextMenuItem>
          <ContextMenuItem onClick={onSettings}>Settings…</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {/* Bare desk takes no clicks of its own, so a right-click there
          reaches the desk's menu beneath; the windows take theirs. */}
      <div
        ref={box}
        className="pointer-events-none absolute inset-0 top-[calc(25px+env(safe-area-inset-top))]"
        style={{
          bottom: "env(safe-area-inset-bottom)",
          ...(away && {
            [away]:
              away === "bottom"
                ? `calc(env(safe-area-inset-bottom) + ${clear}px)`
                : `${clear}px`,
          }),
        }}
      >
        <WindowFrameSnapZoneIndicator snapZoneStyle={glow()} />
        {/* A page a window fills has nowhere left to take hold of it: a
            touch inside a window belongs to what it is showing and never
            reaches the desk. Both edges stay the desk's, so the next
            window is always a thumb away. */}
        {!wide && (
          <>
            <div className="pointer-events-auto absolute top-8 bottom-0 left-0 z-30 w-5" />
            <div className="pointer-events-auto absolute top-8 right-0 bottom-0 z-30 w-5" />
          </>
        )}
        <AnimatePresence>
          {size.h > 0 &&
            // Drawn in one steady order and stacked by number, so raising a
            // window never moves another's element, which would reload it.
            [...page.cards]
              .sort((a, b) => (a.id < b.id ? -1 : 1))
              .map((c) => {
                const full = expanded === c.id;
                const layer = page.cards.findIndex((x) => x.id === c.id);
                const bounds = boundsOf(c);
                // A window is a box on the desk in every state it has:
                // where it was left, where it was carried, the half it
                // was snapped to, or the whole desk when it is filling
                // the screen. Nothing teleports, because nothing ever
                // changes how it is placed — only its four numbers.
                const box = wide
                  ? rectOf(full ? WHOLE : c, bounds)
                  : { left: 0, top: 0, width: size.w, height: size.h };
                return (
                  <motion.div
                    key={c.id}
                    inert={c.stowed}
                    className="pointer-events-none absolute"
                    initial={false}
                    animate={box}
                    // A window let go, snapped or filled grows into its
                    // place; one being carried keeps up with the hand.
                    transition={carried || still ? { duration: 0 } : BASE}
                    style={{ zIndex: full ? 50 : layer }}
                  >
                    <Frame
                      card={c}
                      computers={computers}
                      full={full}
                      wide={wide}
                      index={index}
                      count={count}
                      current={current}
                      onGo={onGo}
                      onMenu={onMenu}
                      front={
                        c.id ===
                        page.cards.filter((x) => !x.stowed && !x.pinned).at(-1)
                          ?.id
                      }
                      stowed={!!c.stowed}
                      born={born.has(c.id)}
                      onArrived={() => born.delete(c.id)}
                      middle={() => middle(c)}
                      desk={size}
                      at={pointAt}
                      onClose={() => onClose(c.id)}
                      onGuard={onGuard}
                      onStow={() => onShape(c.id, { stowed: true }, true)}
                      onShape={(to, save) => onShape(c.id, to, save)}
                      onLanding={setZone}
                      afresh={afresh[c.id] ?? 0}
                      onFront={() => onFront(c.id)}
                      onUnpin={() => onUnpin(c.id)}
                      onCarry={onCarry}
                      onExpand={() => onExpand(c.id)}
                      onCollapse={onCollapse}
                    />
                  </motion.div>
                );
              })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Which window a phone is looking at, one dot each, along the foot of the
// window's bar; a tap on a dot goes to that window.
function Dots({
  count,
  current,
  onGo,
}: {
  count: number;
  current: number;
  onGo: (i: number) => void;
}) {
  if (count < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="Windows"
      className="flex h-4 shrink-0 items-center justify-center gap-1 pb-1"
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-label={`Window ${i + 1} of ${count}`}
          aria-selected={i === current}
          onClick={() => onGo(i)}
          // 6 of dot in a 44 target, as a finger needs.
          className="focus-visible:ring-border-focus-ring relative grid h-3 w-8 place-items-center rounded-full outline-none before:absolute before:inset-x-0 before:-inset-y-4 before:content-[''] focus-visible:ring-2"
        >
          <span
            className={`duration-fast ease-plain size-1.5 rounded-full transition-colors ${
              i === current ? "bg-accent-500" : "bg-foreground-icon-quaternary"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// A sheet up from the bottom of a phone: what a menu is there. It stays in
// the page whether it is open or not, so the controls a panel put in it
// are never taken away and made again.
function PhoneSheet({
  open,
  onClose,
  label,
  children,
  bodyRef,
  controls = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children?: ReactNode;
  bodyRef?: (el: HTMLDivElement | null) => void;
  // Whether what it holds is a panel's own controls, which stretch to the
  // sheet's width, rather than rows of words, which read from the left.
  controls?: boolean;
}) {
  return (
    <Drawer open={open} onOpenChange={(to) => to || onClose()} showSwipeHandle>
      <DrawerContent className="glass-sheet z-[70] rounded-t-3xl border-0 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)] [--drawer-content-max-height:70dvh]">
        <DrawerTitle className="text-caption-1-medium text-text-tertiary px-2 pb-1 text-left">
          {label}
        </DrawerTitle>
        <div
          ref={bodyRef}
          className={`flex flex-col items-stretch gap-2 overflow-y-auto ${
            controls
              ? "[&_[data-slot=button-group]]:w-full [&_button]:justify-center"
              : ""
          }`}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// One line of a phone's sheet: a whole row to a thumb.
function SheetRow({
  children,
  onClick,
  current,
}: {
  children: ReactNode;
  onClick: () => void;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "true" : undefined}
      className={`text-body-medium focus-visible:ring-border-focus-ring duration-fast ease-plain flex min-h-[44px] items-center rounded-2lg px-3 text-left outline-none transition-colors focus-visible:ring-2 active:bg-background-secondary-hover ${
        current
          ? "text-text-primary bg-background-secondary-default"
          : "text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}

// One window's frame, drawn as ryOS draws one: three lights and its name
// in a bar to drag it by, every edge and corner to resize it by, and the
// surface itself. Touching it brings it to the front; it arrives from the
// dock and leaves for it. Our own pages frame as themselves; a port is a colleague's
// computer at another address and is sandboxed to reach nothing of this
// session.
function Frame({
  card,
  computers,
  full,
  wide,
  index,
  count,
  current,
  onGo,
  onMenu,
  front,
  born,
  stowed,
  onArrived,
  middle,
  desk,
  at,
  onClose,
  onGuard,
  onStow,
  onShape,
  onLanding,
  afresh,
  onFront,
  onUnpin,
  onCarry,
  onExpand,
  onCollapse,
}: {
  card: Card;
  computers: boolean;
  full: boolean;
  wide: boolean;
  // Which window of how many, on a phone, and the ways to another and to
  // this one's own menu.
  index: number;
  count: number;
  current: number;
  onGo: (i: number) => void;
  onMenu: () => void;
  // Whether it is the window in front on its desk.
  front: boolean;
  // Whether it was just opened from the dock, and the word that it has
  // arrived and is so no longer.
  born: boolean;
  // Put away in the dock: shrunk into its mark there, still alive.
  stowed: boolean;
  onArrived: () => void;
  // Where its middle is on the screen.
  middle: () => { x: number; y: number } | null;
  desk: { w: number; h: number };
  at: (clientX: number, clientY: number) => { x: number; y: number } | null;
  onClose: () => void;
  onGuard: (key: string, ask: (() => Promise<boolean>) | null) => void;
  onStow: () => void;
  onShape: (to: Partial<Card>, save: boolean) => void;
  onLanding: (zone: { at: Box & Point; bounds: Bounds } | null) => void;
  afresh: number;
  onFront: () => void;
  // A widget made a window again, in front.
  onUnpin: () => void;
  onCarry: (carrying: boolean) => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const Mark = markOf(card);
  const free = wide && !full;
  // On the desk as a widget: a strip of its own to move it by instead of
  // a bar, and a menu there for making it a window or taking it off.
  const widget = !!card.pinned;
  // The most this window is worth drawing at; a widget is whatever size
  // it was put down at.
  const bounds = boundsOf(card);
  const Panel = PANELS[card.href];
  // Where the panel's own controls go, in the bar after the name.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [lead, setLead] = useState<HTMLDivElement | null>(null);
  // A phone's two places for a panel's controls: the strip under the bar,
  // and the sheet the bar's last control opens.
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  // The panel's own way to hold this window open while it asks something.
  const beforeClose = useCallback(
    (ask: (() => Promise<boolean>) | null) => onGuard(card.id, ask),
    [onGuard, card.id],
  );

  // A phone's bar is the window's handle: a drag along it turns to the
  // window beside this one, a drag down it puts this one away.
  const swipe = (e: PointerEvent<HTMLDivElement>) => {
    if (wide) return;
    const from = { x: e.clientX, y: e.clientY };
    const done = (m: globalThis.PointerEvent) => {
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", give);
      const dx = m.clientX - from.x;
      const dy = m.clientY - from.y;
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy > SWIPE) onStow();
      } else if (Math.abs(dx) > SWIPE && count > 1) {
        const to = index + (dx < 0 ? 1 : -1);
        if (to >= 0 && to < count) onGo(to);
      }
    };
    // A drag the browser takes for itself ends it as far as we are
    // concerned: nothing is acted on twice.
    const give = () => {
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", give);
    };
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", give);
  };

  // A window holding somebody else's page comes to the front when that
  // page takes the keyboard.
  useEffect(() => {
    const took = () => {
      if (frame.current && document.activeElement === frame.current) onFront();
    };
    window.addEventListener("blur", took);
    return () => window.removeEventListener("blur", took);
  }, [onFront]);

  // A drag by the bar moves the window; a drag by any edge or corner
  // resizes it from that side, so a window can be taken in at the top or
  // the left as readily as let out at the bottom right. The pointer is
  // held until it lifts, so a fast hand never loses it.
  const drag = (what: "move" | Edge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !free || desk.w <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const from = { x: e.clientX, y: e.clientY };
    // Taken hold of where it is drawn, which for a held window is
    // not where its numbers say: from here on the two agree.
    const was = fit(card, desk, bounds);
    // The least and the most it may be pulled to, as shares of this desk,
    // neither of them more than the desk itself.
    const most = {
      w: Math.min(1, (bounds.max?.w ?? Infinity) / desk.w),
      h: Math.min(1, (bounds.max?.h ?? Infinity) / desk.h),
    };
    const least = {
      w: Math.min(most.w, (bounds.min.w ?? 0) / desk.w),
      h: Math.min(most.h, (bounds.min.h ?? 0) / desk.h),
    };
    onCarry(true);
    const to = (m: globalThis.PointerEvent): Partial<Card> => {
      const dx = (m.clientX - from.x) / desk.w;
      const dy = (m.clientY - from.y) / desk.h;
      if (what === "move") return { ...was, x: was.x + dx, y: was.y + dy };
      // The side being pulled goes where the hand is, as far as the desk,
      // the window's own most, and no further; the side across from it does
      // not move, and the window is what lies between them.
      const held: Partial<Card> = { ...was };
      if (what.includes("e"))
        held.w = between(was.w + dx, least.w, Math.min(1 - was.x, most.w));
      if (what.includes("s"))
        held.h = between(was.h + dy, least.h, Math.min(1 - was.y, most.h));
      if (what.includes("w")) {
        held.x = between(
          was.x + dx,
          Math.max(0, was.x + was.w - most.w),
          was.x + was.w - least.w,
        );
        held.w = was.x + was.w - held.x;
      }
      if (what.includes("n")) {
        held.y = between(
          was.y + dy,
          Math.max(0, was.y + was.h - most.h),
          was.y + was.h - least.h,
        );
        held.h = was.y + was.h - held.y;
      }
      return held;
    };
    const where = (m: globalThis.PointerEvent) => {
      if (what !== "move") return null;
      const p = at(m.clientX, m.clientY);
      return p ? landing(p.x, p.y) : null;
    };
    // A click is not a drag: until the hand has moved a few pixels, the
    // window stays as it is and lands nowhere.
    let moved = false;
    const onMove = (m: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - from.x, m.clientY - from.y) < 4)
        return;
      moved = true;
      onShape(to(m), false);
      const lands = where(m);
      onLanding(lands && { at: lands, bounds });
    };
    const onUp = (m: globalThis.PointerEvent) => {
      onLanding(null);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      onCarry(false);
      if (!moved) return;
      const lands = where(m);
      if (lands) requestAnimationFrame(() => onShape(lands, true));
      else onShape(to(m), true);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  // The way from this window's middle to a mark in the dock.
  const flight = (el: Element | null) => {
    const m = middle();
    if (!el || !m) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - m.x, y: r.top + r.height / 2 - m.y };
  };
  const own = () =>
    document.querySelector(`[data-dock-icon="${CSS.escape(card.id)}"]`);
  // How it arrives: out of its own mark in the dock when it was put away,
  // out of its block's when just opened from there, and with a breath of
  // scale otherwise. Measured once, as it is first drawn, which is also
  // the one time being just opened counts. Where travel would be the
  // whole of it, a hand that asked for less motion gets a fade in place.
  const still = useReducedMotion();
  const fresh = useRef(born);
  useEffect(() => {
    onArrived();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [arrival] = useState(() => {
    if (still) return { opacity: 0 };
    const from =
      flight(own()) ??
      (born
        ? flight(
            document.querySelector(
              `[data-dock-icon="${CSS.escape(card.href)}"]`,
            ),
          )
        : null);
    return from
      ? { scale: 0.1, opacity: 0, x: from.x, y: from.y }
      : { scale: 0.95, opacity: 0 };
  });

  // Put away, the window shrinks into its mark in the dock and stays
  // there, mounted, so what it holds is not lost; measured a frame later,
  // once the dock has made room for the mark.
  const [away, setAway] = useState<TargetAndTransition | null>(null);
  useEffect(() => {
    if (!stowed) return setAway(null);
    const frame = requestAnimationFrame(() =>
      setAway(getExitAnimation(() => flight(own()), !!still)),
    );
    return () => cancelAnimationFrame(frame);
  }, [stowed]);

  return (
    <motion.div
      initial={arrival}
      animate={
        (stowed && away) || {
          scale: 1,
          opacity: 1,
          x: 0,
          y: 0,
          transition: still ? BASE : FLIGHT,
        }
      }
      exit={getExitAnimation(() => flight(own()), !!still)}
      className="relative size-full"
      style={{ transformOrigin: "center" }}
    >
      {/* The deeper shadow the window in front casts, its own layer over
          the shallow one every window has, so coming to the front is a
          cross-fade and never a shadow being redrawn. */}
      {!widget && (
        <div
          aria-hidden
          className={`ease-plain duration-fast pointer-events-none absolute inset-0 rounded-3xl transition-opacity ${
            front ? "opacity-100" : "opacity-0"
          }`}
          style={{ boxShadow: "0 12px 35px rgb(0 0 0 / 0.6)" }}
        />
      )}
      <div
        data-window
        onPointerDownCapture={onFront}
        className={`glass-pane @container relative flex h-full flex-col overflow-hidden rounded-3xl ${
          stowed ? "pointer-events-none" : "pointer-events-auto"
        }`}
        style={
          {
            // A widget lies on the desk and casts nothing; a window casts
            // the shallow shadow, with the front one's layer over it.
            "--pane-cast": widget ? "none" : "0 4px 15px rgb(0 0 0 / 0.2)",
          } as React.CSSProperties
        }
      >
        {widget ? (
          <ContextMenu>
            <ContextMenuTrigger
              render={
                <div
                  onPointerDown={free ? drag("move") : undefined}
                  className="glass-solid border-separator-border group/grip relative z-20 flex h-[20px] shrink-0 cursor-move touch-none items-center gap-1.5 border-b px-2"
                />
              }
            >
              <span
                aria-hidden
                className="bg-foreground-icon-tertiary ease-plain duration-fast h-0.5 w-4 shrink-0 rounded-full opacity-40 transition-opacity group-hover/grip:opacity-100"
              />
              <span className="text-caption-1-medium text-text-secondary truncate">
                {card.title}
              </span>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={onUnpin}>
                Open as a window
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={onClose}>
                Take off the desk
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : !wide ? (
          // A phone's bar: the way back at the left, the name in the
          // middle, and one control at the right for everything the
          // panel itself offers. No lights, nothing to drag by, nothing
          // to fill: a window here is already the screen.
          <>
            <div className="border-separator-border bg-background-primary-default/70 shrink-0 border-b">
              <div
                onPointerDown={swipe}
                className="grid h-[44px] grid-cols-[44px_1fr_44px] items-center [touch-action:none] select-none"
              >
                <button
                  type="button"
                  aria-label={count > 1 ? "Back" : "Close"}
                  onClick={() =>
                    count > 1
                      ? onGo(index > 0 ? index - 1 : count - 1)
                      : onClose()
                  }
                  className="text-foreground-icon-secondary focus-visible:ring-border-focus-ring grid size-[44px] place-items-center rounded-2lg outline-none focus-visible:ring-2"
                >
                  {count > 1 ? (
                    <RiArrowLeftSLine aria-hidden className="size-5" />
                  ) : (
                    <RiCloseLine aria-hidden className="size-5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onMenu}
                  aria-haspopup="dialog"
                  className="text-body-medium text-text-primary focus-visible:ring-border-focus-ring mx-auto flex h-[44px] min-w-0 items-center gap-2 rounded-2lg px-2 outline-none focus-visible:ring-2"
                >
                  <Mark
                    aria-hidden
                    className="text-foreground-icon-secondary size-4 shrink-0"
                  />
                  <span className="truncate">{card.title}</span>
                </button>
                {Panel ? (
                  <button
                    type="button"
                    aria-label="What this window can do"
                    aria-expanded={sheet}
                    onClick={() => setSheet(true)}
                    className="text-foreground-icon-secondary focus-visible:ring-border-focus-ring grid size-[44px] place-items-center rounded-2lg outline-none focus-visible:ring-2"
                  >
                    <RiMoreLine aria-hidden className="size-5" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
              <Dots count={count} current={current} onGo={onGo} />
            </div>
            {/* The few controls a panel is looked at through — a path, an
                address — stay in view, in a strip that scrolls sideways. */}
            {Panel && (
              <div
                ref={setStrip}
                data-controls
                className="border-separator-border flex h-[38px] shrink-0 items-center gap-2 overflow-x-auto border-b px-3 [scrollbar-width:none] empty:hidden [&::-webkit-scrollbar]:hidden"
              />
            )}
          </>
        ) : (
          <div
            onPointerDown={free ? drag("move") : undefined}
            onDoubleClick={full ? onCollapse : onExpand}
            className={`border-separator-border bg-background-primary-default/70 relative flex h-[44px] shrink-0 items-center border-b select-none ${
              free ? "cursor-move touch-none" : ""
            }`}
          >
            <div
              className="group/traffic relative ml-2.5 flex items-center gap-2 max-sm:gap-3"
              data-titlebar-controls
            >
              <TrafficLightButton
                color="red"
                onClick={onClose}
                isForeground={front}
                ariaLabel="Close"
              />
              <TrafficLightButton
                color="yellow"
                onClick={onStow}
                isForeground={front}
                ariaLabel="Put away"
              />
              <TrafficLightButton
                color="green"
                onClick={full ? onCollapse : onExpand}
                isForeground={front}
                ariaLabel={full ? "Back to its place" : "Fill the screen"}
              />
            </div>
            {/* One placing for every window: the lights, whatever stands
                for the panel as a whole, the window's mark and name, and
                then the panel's own controls with the rest of the row.
                The name shortens; it is never taken away, since for the
                second window of an app the number in it is all there is
                to tell them apart. */}
            {Panel && (
              <div
                ref={setLead}
                data-controls
                className="ml-2 flex shrink-0 items-center gap-1 empty:hidden"
              />
            )}
            <span
              className={`text-body-medium pointer-events-none ml-3 flex min-w-0 shrink items-center gap-2 ${
                front ? "text-text-primary" : "text-text-secondary"
              }`}
            >
              <Mark className="text-foreground-icon-secondary size-5 shrink-0" />
              <span className="truncate">{card.title}</span>
            </span>
            {Panel && (
              <div
                ref={setSlot}
                data-controls
                className="mr-2 ml-3 flex min-w-0 flex-1 items-center gap-2"
              />
            )}
          </div>
        )}
        {Panel && !computers ? (
          <div className="p-3">
            <Notification
              status="information"
              title="Computers are off here"
              description="Computers are off on this copy of Maslow."
              dismissible={false}
            />
          </div>
        ) : Panel ? (
          // Inside a window only the frame is rounded: a panel's root
          // meets the bar and both sides, so it keeps no corner and no
          // border of its own where it does.
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:rounded-none [&>*]:border-0">
            <BarSlot
              value={{
                controls: slot,
                leading: lead,
                strip,
                phone: !wide,
                beforeClose,
              }}
            >
              <Panel fresh={fresh.current} id={card.id} />
            </BarSlot>
          </div>
        ) : (
          <iframe
            key={afresh}
            ref={frame}
            src={card.href}
            title={card.title}
            className={`min-h-0 flex-1 ${card.kind === "port" ? "bg-background-full" : "bg-transparent"}`}
            sandbox={
              card.kind === "port"
                ? "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                : undefined
            }
            // A page on a port may ask for the microphone, the camera, the
            // screen or the clipboard, as a recorder or a meeting app would;
            // the browser still asks the person each time.
            allow={
              card.kind === "port"
                ? "microphone; camera; display-capture; clipboard-read; clipboard-write"
                : undefined
            }
          />
        )}
      </div>
      {/* What the panel's own controls become on a phone: rows in a sheet
          the bar opens. */}
      {!wide && Panel && (
        <PhoneSheet
          open={sheet}
          onClose={() => setSheet(false)}
          label={card.title}
          bodyRef={setSlot}
          controls
        />
      )}
      {/* Outside the pane, which clips what it holds, so each strip
          straddles the frame it takes hold of. */}
      {free &&
        EDGES.map(([edge, where]) => (
          <div
            key={edge}
            aria-hidden
            onPointerDown={drag(edge)}
            className={`pointer-events-auto absolute z-10 touch-none ${where}`}
          />
        ))}
    </motion.div>
  );
}
