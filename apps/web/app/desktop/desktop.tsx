"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type TargetAndTransition,
} from "motion/react";
import { RiMoreLine } from "@remixicon/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type PointerEvent,
} from "react";

import { LiveBrowser } from "@/app/browser/live";
import { Look } from "@/app/computer/files/look";
import { FileExplorer } from "@/app/computer/files/file-explorer";
import { Agent } from "@/app/computer/agent/agent";
import { Terminal } from "@/app/computer/terminal/terminal";
import {
  anotherOf,
  APPS,
  boundsOf,
  boxOf,
  pathOf,
  type Bounds,
} from "@/app/desktop/apps";
import { CommandBar } from "@/app/desktop/command";
import {
  Dock,
  DRAG,
  type Dragged,
  type Held,
  clearOf,
  type Side,
  useDockIconSize,
} from "@/app/desktop/dock";
import { MenuBar, type Me } from "@/app/desktop/menubar";
import { srcOf } from "@/app/desktop/wallpapers";
import { BarButton, BarSlot } from "@/app/desktop/panel";
import { PhoneSheet } from "@/app/desktop/sheet";
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
  type SavedDesktop,
  type Port,
  type Screen,
} from "@/app/desktop/tiles";
import { BASE, FLIGHT } from "@/lib/motion";
import { cx } from "@/utils/cx";
import {
  getExitAnimation,
  TrafficLightButton,
  WindowFrameSnapZoneIndicator,
} from "@/app/desktop/window";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePhone } from "@/hooks/use-phone";

// Whether the dock hides when the hand leaves it, and whether its icons
// swell under the pointer, remembered on this device.
const HIDING = "maslow.dock.hiding";
const MAGNIFY = "maslow.dock.magnify";
const DOCK_SIDE = "maslow.dock.side";

// A point on the desktop, as shares of its width and height.
type Point = { x: number; y: number };

const EMPTY: Screen = { cards: [] };

// The surfaces that are panels: drawn in the window itself, their
// controls in its bar, told which window on the desktop they are and when it
// was just opened. Every other surface is framed as the page it is.
const PANELS: Record<
  string,
  ComponentType<{ fresh?: boolean; id?: string; href?: string }>
> = {
  "/computer/agent": Agent,
  "/computer/terminal": Terminal,
  "/computer/files": FileExplorer,
  "/computer/files/view": Look,
  "/browser": LiveBrowser,
};

// One page of the rail: a desktop and the windows on it.
type Page = { key: string; cards: Card[] };

// Whether what is listening is what was listening, so a beat that finds
// nothing new leaves the dock alone.
const same = (a: Port[], b: Port[]) => JSON.stringify(a) === JSON.stringify(b);

// How many cards a desktop holds at most, as the server keeps it.
const MOST = 32;

// How far past an edge still counts as meaning that edge.
const OVER = 0.08;

// Where a window goes when it is carried to a side of the desktop: the side
// gives it that half, and either end of that side gives it the quarter
// there. How near counts is in the desktop's own size, so it is the same
// reach on any screen; the ends are a long stretch, so a corner is as easy
// to mean as a side.
const SIDE = 0.06;
// How far along an edge a corner reaches. Past it, the edge is its half.
const END = 0.2;
// The whole desktop: what a window filling the screen is given, and what a
// window carried to the top edge lands on.
const WHOLE: Box & Point = { x: 0, y: 0, w: 1, h: 1 };
// Seven places and no more: the whole desktop, a half at either side, and
// the four quarters at the corners. A hand carrying a window has to tell
// them apart in the moment, so the vocabulary is the one every desktop
// already teaches, and nothing finer.
function landing(x: number, y: number): (Box & Point) | null {
  const l = x < SIDE;
  const r = x > 1 - SIDE;
  const u = y < SIDE;
  const d = y > 1 - SIDE;
  if (!l && !r && !u && !d) return null;
  const left = x < END;
  const right = x > 1 - END;
  const top = y < END;
  const bottom = y > 1 - END;
  // A corner is a quarter, reached from either of the two edges that meet
  // there, so the aim that misses one catches the other.
  if ((l || r) && (top || bottom))
    return { x: r ? 0.5 : 0, y: bottom ? 0.5 : 0, w: 0.5, h: 0.5 };
  if ((u || d) && (left || right))
    return { x: right ? 0.5 : 0, y: d ? 0.5 : 0, w: 0.5, h: 0.5 };
  // A side, along all the rest of it, is that half.
  if (l || r) return { x: r ? 0.5 : 0, y: 0, w: 0.5, h: 1 };
  // The top is the whole desktop, where a window carried straight up is
  // heading anyway. The bottom is nowhere: there is no half below to land
  // on, and a window dragged near the dock keeps the place it was in.
  return u ? WHOLE : null;
}

// The six a keyboard can ask for by name. The seventh place a hand can
// carry a window to, the whole desktop, is the green light's act instead.
const PLACES: Record<string, Box & Point> = {
  left: { x: 0, y: 0, w: 0.5, h: 1 },
  right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  "top left": { x: 0, y: 0, w: 0.5, h: 0.5 },
  "top right": { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  "bottom left": { x: 0, y: 0.5, w: 0.5, h: 0.5 },
  "bottom right": { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
};

// What a key means, held with Control and Option: the arrows for the two
// sides and the keys under a right hand for the four corners. Up and down
// name no place: there are no halves above and below any more, and the
// screen is filled with the green light's own key. By the key's place,
// not its name: with Option held a Mac names a letter something else.
// Nothing here is a key a Mac or a browser keeps.
const ASKS: Record<string, string> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyU: "top left",
  KeyI: "top right",
  KeyJ: "bottom left",
  KeyK: "bottom right",
};

// A window's sides and corners, each a strip to take hold of: the corners
// wide enough to catch before the edges they sit between.
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
// Each strip straddles the frame, half in and half out, so a hand aiming
// at the edge from the desktop catches it as readily as one aiming from
// inside the window.
// How far in from either side a phone's window stands (ryOS
// WindowFrame.tsx:268, `p-2 md:p-0`).
const INSET = 8;

// On a phone a window is resized from its top and its bottom only. The
// bottom is a 24px strip a thumb can find, half of it inside the frame;
// the top, which lies flush under the menu bar, is a thin strip inside
// it that starts past the lights, as ryOS's does on its Mac look
// (WindowFrameResizeHandles.tsx:44-70).
const PHONE_EDGES: [Edge, string][] = [
  ["n", "-top-1 right-2 left-20 h-3 cursor-ns-resize"],
  ["s", "-bottom-3 right-2 left-2 h-6 cursor-ns-resize"],
];

// A short buzz under the finger, where the phone has one to give.
const buzz = (ms: number) => navigator.vibrate?.(ms);

const EDGES: [Edge, string][] = [
  ["n", "-top-1 right-4 left-4 h-2 cursor-ns-resize"],
  ["s", "-bottom-1 right-4 left-4 h-2 cursor-ns-resize"],
  ["w", "top-4 bottom-4 -left-1 w-2 cursor-ew-resize"],
  ["e", "top-4 -right-1 bottom-4 w-2 cursor-ew-resize"],
  // A corner straddles the frame evenly, six pixels out and six in, so it
  // stops where the lights begin and a click on the red one closes.
  ["nw", "-top-1.5 -left-1.5 size-3 cursor-nwse-resize"],
  ["ne", "-top-1.5 -right-1.5 size-3 cursor-nesw-resize"],
  ["sw", "-bottom-1.5 -left-1.5 size-3 cursor-nesw-resize"],
  ["se", "-right-1.5 -bottom-1.5 size-3 cursor-nwse-resize"],
];

export function Desktop({
  desktop,
  ports,
  you,
  computers,
  wallpaper,
}: {
  desktop: SavedDesktop;
  ports: Port[];
  // What this person's desktop lies on, as they left it.
  wallpaper: string | null;
  you: (Me & Pick<Known, "picture">) | undefined;
  // Whether this deployment makes computers at all.
  computers: boolean;
}) {
  const [screen, setScreenState] = useState<Screen>(desktop.layout ?? EMPTY);
  // The wallpaper the desktop wears.
  const [paper, setPaper] = useState<string | null>(wallpaper);
  // What this device keeps of the desktop, for the lock screen to wear and to
  // greet whoever signs in next by: the wallpaper, and who was here.
  useEffect(() => rememberPaper(paper), [paper]);
  useEffect(() => {
    if (you)
      remember({ email: you.email, name: you.name, picture: you.picture });
  }, [you?.email, you?.name, you?.picture]);
  // What is listening, kept current while the desktop is open. Nothing is
  // asked while the tab is not being looked at.
  const [live, setLive] = useState(ports);
  // The command bar: open or not, and what was typed to open it.
  const [bar, setBar] = useState({ open: false, initial: "" });
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
        const res = await fetch("/desktop/ports").catch(() => null);
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
          // The desktop kept elsewhere since this page saw it, a widget the
          // agent placed most often, is taken in.
          // Not while a save of this page's own is out: its answer says
          // where the desktop stands, and the next ask is seconds away.
          if (now.rev > rev.current && saving.current === 0) {
            const desktop = await fetch("/desktop/layout").catch(() => null);
            const got = desktop?.ok
              ? ((await desktop
                  .json()
                  .catch(() => null)) as SavedDesktop | null)
              : null;
            // Asked again once the desktop is here: a save may have gone
            // out while it was on its way.
            if (got && !stopped && saving.current === 0) take(got);
          }
        }
      } finally {
        asking = false;
      }
    };
    // Asked every two seconds, so a window opened or filled on another
    // device is here before the hand leaves it, and every second while a
    // window is showing a port that has stopped, so a restart is over
    // before it is noticed.
    const soon = () => {
      clearTimeout(beat);
      if (!stopped) beat = setTimeout(look, doubted.current.size ? 1000 : 2000);
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

  // Which window fills the screen: kept with the desktop, so it fills the
  // screen on every device the person opens; one at most, and in front.
  const filled = (cards: Card[]) =>
    cards.findLast((c) => c.full && !c.minimized && !c.pinned)?.id ?? null;
  const expanded = filled(screen.cards);
  const setExpanded = (
    to: string | null | ((was: string | null) => string | null),
  ) =>
    setScreen((l) => {
      const was = filled(l.cards);
      const next = typeof to === "function" ? to(was) : to;
      if (next === was) return null;
      const cards = l.cards.map(({ full: _, ...c }) =>
        c.id === next ? { ...c, full: true, minimized: false } : c,
      );
      const it = cards.find((c) => c.id === next);
      return {
        cards: it ? [...cards.filter((c) => c.id !== next), it] : cards,
      };
    });
  // A block picked from the toolbar, waiting to be put down where the
  // person clicks.
  const carrying = useRef<Dragged | null>(null);
  // While anything is dragged, the windows' frames stop taking the
  // pointer: a frame would swallow the drag as its own.
  const [carried, setCarried] = useState(false);
  const [preview, setPreview] = useState<Point | null>(null);

  // Whether the dock hides when the hand leaves it. Hidden, the desktop
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
  // desktop at once: the device's store says so.
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

  // Two widths matter, as in ryOS: under 640 it is a phone (useIsPhone.ts),
  // with the dock hiding along the bottom and the menus in a strip; under
  // 768 (useWindowManager.ts:39, WindowFrame.tsx:277) every window is the
  // full width and moves up and down only, so a phone turned sideways
  // keeps its windows whole. Above both it is a desktop.
  const wide = !usePhone();
  const [medium, setMedium] = useState(true);
  useEffect(() => {
    const tablet = matchMedia("(min-width: 768px)");
    const read = () => setMedium(tablet.matches);
    read();
    tablet.addEventListener("change", read);
    return () => tablet.removeEventListener("change", read);
  }, []);
  // The edge the dock lies along, for the desktop to keep clear of: none
  // while it hides.
  // On a phone the dock lies along the bottom and hides on its own, so
  // the windows have the whole height (ryOS useWindowInsets.ts:64-66:
  // a hiding dock takes nothing).
  // On a phone the dock is along the bottom and stays until a window fills
  // the screen, so the desktop keeps clear of it there too.
  const away: Side | null = !wide
    ? expanded !== null
      ? null
      : "bottom"
    : hiding
      ? null
      : side;

  // Escape brings an expanded window back down.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setExpanded(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // Every window, open or minimized.
  const held: Held[] = screen.cards.map((card) => ({
    screen: desktop.id,
    card,
  }));

  // The windows, as the dock and the menu bar list them: a widget is
  // neither open nor minimized, it is part of the desktop.
  const windows = held.filter((w) => !w.card.pinned);
  const page: Page = { key: desktop.id, cards: screen.cards };

  // A window brought to the front, out of the dock if it was minimized.
  const raise = (w: Held) => {
    if (w.card.pinned) return;
    setScreen((l) => {
      const c = l.cards.find((x) => x.id === w.card.id);
      if (!c) return null;
      return {
        cards: [
          ...l.cards.filter((x) => x.id !== w.card.id),
          { ...c, minimized: false },
        ],
      };
    });
  };

  // How many times the desktop has been kept, as this page last saw it. A
  // save names it; one that fell behind is refused, and the desktop as it now
  // is comes back to be taken in, this page's own changes kept over it.
  const rev = useRef(desktop.rev);
  // The desktop as this page last knew it kept, which its own changes since
  // are measured against when a desktop kept elsewhere is taken in.
  const known = useRef<Screen>(desktop.layout ?? EMPTY);
  // Saves go one after another, each carrying the desktop as it is when its
  // turn comes, so a later change is never written over by an earlier
  // save's answer.
  const saves = useRef(Promise.resolve());
  // How many saves are out, since a desktop taken in while one is would
  // mistake what it saved for a change still to make.
  const saving = useRef(0);
  const persist = () => {
    saving.current += 1;
    saves.current = saves.current.then(async () => {
      const layout = latest.current;
      const res = await fetch("/desktop/layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: desktop.id, layout, rev: rev.current }),
      }).catch(() => null);
      if (!res || (!res.ok && res.status !== 409)) return;
      const got = (await res.json().catch(() => null)) as SavedDesktop | null;
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
  // The desktop as it is this moment, for a change made from a pointer
  // handler that closed over an earlier render; kept once, sent once.
  const latest = useRef(screen);
  latest.current = screen;
  // The cards a pointer is moving or resizing this moment, whose place on
  // this page is truer than any kept elsewhere.
  const gripped = useRef(new Set<string>());
  // The cards this page has changed or opened whose save has not landed.
  const unsaved = useRef(new Set<string>());
  // The desktop as it was kept elsewhere, taken in: what it holds is what
  // stays, except what this page changed since it last knew the desktop
  // kept, which is kept over it: a card added, a card taken away, a card
  // moved, a card under the pointer, and the order this page's windows
  // stack in. What the desktop was kept as stays the measure until a save of
  // this page's own lands. A save refused for falling behind takes the
  // desktop in and keeps it again.
  const take = (got: SavedDesktop, again = false) => {
    // A desktop older than the one this page already has is a late answer;
    // a save refused on it is still owed, against the desktop as it is now.
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
        // Kept over the desktop as kept, it is a change still to save, and
        // stays one through every desktop taken in until it lands.
        unsaved.current.add(id);
        return m;
      }
      if (!m && b) return null;
      return t ?? null;
    };
    // The cards in the order the desktop was kept in, so the window in
    // front is the same on every device, with what this page opened since
    // on top; what this page took away since is not back because the
    // desktop kept elsewhere still had it. Every widget lies under every
    // window, each group in its own order. A desktop is only so big: past
    // its most, what arrived last is left off, since a desktop the server
    // would refuse could never be kept again.
    const ours = new Set(mine.map((c) => c.id));
    const gone = new Set(base.map((c) => c.id));
    const stayed = mine
      .map((c) => keep(c.id))
      .filter((c): c is Card => c !== null);
    const arrived = theirs
      .filter((c) => !ours.has(c.id) && !gone.has(c.id))
      .slice(0, Math.max(0, MOST - stayed.length));
    const rank = new Map(theirs.map((c, i) => [c.id, i]));
    const met = [...stayed, ...arrived].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
    // One window fills the screen at most: two devices filling two at
    // once meet here, and the one in front wins.
    const front = met.findLast((c) => c.full && !c.minimized && !c.pinned);
    const one = met.map(({ full, ...c }) =>
      full && c.id === front?.id ? { ...c, full } : c,
    );
    const cards = [
      ...one.filter((c) => c.pinned),
      ...one.filter((c) => !c.pinned),
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

  // A block landing on the desktop: a new window at the block's own size,
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
        // On a phone a window opens under the menu bar, not down a cascade.
        ...(medium ? {} : { y: 0 }),
        ...(pinned ? { pinned } : {}),
      });
    };
    let made: Card | null = null;
    // A widget lies on the desktop, under every window: first in the stack.
    setScreen((l) => {
      made = open(l.cards);
      return { cards: pinned ? [made, ...l.cards] : [...l.cards, made] };
    });
    return made;
  };
  // A port put on the desktop as a widget, laid from the far corner inward:
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
  // and nothing else the desktop could know about.
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

  // A block picked from the dock opens on the desktop.
  const pick = (b: Dragged) => void land(b);
  // An app as the dock opens it: its last window forward, or a first one.
  const open = (b: Dragged) => {
    const last = windows
      .filter((w) => pathOf(w.card.href) === pathOf(b.href))
      .at(-1);
    if (last) raise(last);
    else pick(b);
  };
  // Settings at an address of its own: the Settings window already open,
  // brought forward and turned to it, or a first one.
  const settingsAt = (href: string) => {
    const had = windows
      .filter((w) => pathOf(w.card.href) === "/settings")
      .at(-1);
    if (had) {
      raise(had);
      if (href !== "/settings") shape(had.card.id, { href }, true);
      return;
    }
    pick({
      kind: "settings",
      title: "Settings",
      href,
      box: boxOf({ kind: "settings", href: "/settings" }),
    });
  };
  // Settings, on a pane if one is asked for, at one of its sections if a
  // section is.
  const settings = (pane?: string, section?: string) =>
    settingsAt(
      pane
        ? `/settings?pane=${pane}${section ? `#${section}` : ""}`
        : "/settings",
    );
  // A tab that left the desk to sign in to an app comes back to it with
  // the Settings window open on what came of it, and the address plain
  // again, so a reload does not open it twice.
  useEffect(() => {
    const asked = new URLSearchParams(location.search);
    if (asked.get("maslow") !== "settings") return;
    asked.delete("maslow");
    settingsAt(`/settings?${asked}`);
    history.replaceState(null, "", location.pathname);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // A port of the person's own that the computer asked the desktop to open:
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
  // A folder of theirs, named as their home has it: Files, at that
  // folder.
  const openFile = (path: string) =>
    pick({
      kind: "page",
      title: path.split("/").filter(Boolean).at(-1) ?? "Files",
      href: `/computer/files?path=${encodeURIComponent(path)}`,
      box: boxOf({ kind: "page", href: "/computer/files" }),
    });
  // A web address: the computer's own browser turned to it, the window
  // already up or a first one.
  const openBrowser = (url: string) => {
    const href = `/browser?url=${encodeURIComponent(url)}&at=${Date.now()}`;
    const had = windows
      .filter((w) => pathOf(w.card.href) === "/browser")
      .at(-1);
    if (had) {
      raise(had);
      shape(had.card.id, { href }, true);
      return;
    }
    pick({
      kind: "page",
      title: "Browser View",
      href,
      box: boxOf({ kind: "page", href: "/browser" }),
    });
  };
  // A file of theirs, or one a colleague shared: the Preview window,
  // named for the file.
  const openView = (path: string, share?: { id: string; name: string }) =>
    pick({
      kind: "page",
      title: path.split("/").filter(Boolean).at(-1) ?? share?.name ?? "Preview",
      href: share
        ? `/computer/files/view?share=${encodeURIComponent(share.id)}&path=${encodeURIComponent(path)}`
        : `/computer/files/view?path=${encodeURIComponent(path)}`,
      box: { w: 0.46, h: 0.62 },
    });

  // The next window forward, or the front one to the back.
  const cycle = (back: boolean) =>
    setScreen((l) => {
      const up = l.cards.filter((c) => !c.minimized && !c.pinned);
      if (up.length < 2) return null;
      const rest = l.cards.filter((c) => c.minimized || c.pinned);
      const order = back
        ? [...up.slice(-1), ...up.slice(0, -1)]
        : [...up.slice(1), up[0]!];
      return {
        cards: [
          ...rest.filter((c) => c.pinned),
          ...order,
          ...rest.filter((c) => c.minimized),
        ],
      };
    });

  // The window in front.
  const top = page.cards.filter((c) => !c.minimized && !c.pinned).at(-1);
  const atFront: Held | null = top ? { screen: desktop.id, card: top } : null;
  // What the desktop answers to. Command-K opens the bar from anywhere in
  // the desktop; a plain letter typed with nothing focused opens it with
  // that letter; Control and Option with a letter or an arrow acts on the
  // window in front, putting it on a side, a corner or the whole desktop.
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
          const b = APPS.find((x) => x.href === "/computer/terminal")!;
          const { mark: _mark, ...terminal } = b;
          pick(front ? anotherOf(front) : terminal);
        } else if (k === "KeyW" && front) {
          e.preventDefault();
          void close(front.id);
        } else if (k === "KeyM" && front) {
          e.preventDefault();
          shape(front.id, { minimized: true }, true);
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
    // A framed page asks the same of the desktop with Command-K.
    const said = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const asked = e.data as {
        maslow?: string;
        choice?: unknown;
        href?: unknown;
        title?: unknown;
        port?: unknown;
        path?: unknown;
        view?: unknown;
        share?: unknown;
        file?: unknown;
        url?: unknown;
      };
      if (asked?.maslow === "command") setBar({ open: true, initial: "" });
      // A record named anywhere on the desktop — the menu bar's notifications, a
      // framed page — opened in the Brain window.
      if (
        asked?.maslow === "record" &&
        typeof asked.href === "string" &&
        typeof asked.title === "string"
      )
        brain(asked.href, asked.title);
      // A wallpaper picked in a Settings window is worn by the desktop at once.
      if (asked?.maslow === "wallpaper" && typeof asked.choice === "string")
        setPaper(asked.choice);
      // Something a program on the computer asked to open: a port of
      // theirs, which is a window on the desktop, or a file of theirs, which
      // is Files at its folder.
      if (asked?.maslow === "open") {
        if (typeof asked.port === "number") openPort(asked.port);
        else if (typeof asked.view === "string")
          openView(
            asked.view,
            asked.share &&
              typeof asked.share === "object" &&
              "id" in asked.share
              ? (asked.share as { id: string; name: string })
              : undefined,
          );
        else if (typeof asked.path === "string")
          (asked.file ? openView : openFile)(asked.path);
        else if (typeof asked.url === "string") openBrowser(asked.url);
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
        onMinimize={(w) => shape(w.card.id, { minimized: true }, true)}
        onFill={(w) => setExpanded(w.card.id)}
        onClose={(w) => void close(w.card.id)}
        onSearch={() => setBar({ open: true, initial: "" })}
        onCycle={cycle}
        onSnap={(place) => top && shape(top.id, PLACES[place]!, true)}
        onSettings={settings}
      />
      <link rel="prefetch" href="/settings?pane=you" as="document" />
      <link rel="prefetch" href="/brain" as="document" />
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
        onFile={(path) => openView(path)}
      />
      <div
        className={`fixed inset-0 z-10 flex ${
          carried ? "[&_iframe]:pointer-events-none" : ""
        }`}
      >
        {[page].map((p) => (
          <DesktopPage
            key={p.key}
            page={p}
            narrow={!medium}
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

      <Dock
        phone={!wide}
        hiding={wide ? hiding : expanded !== null}
        magnify={wide && magnify}
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

// What the desktop sits on: the picture the person chose, over the bare warm
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
  // Whether the ground under the menu bar is light, read from the top of
  // the picture shown, or from the scheme when there is none, so the
  // bar's words are dark on a light ground and white on a dark one.
  useEffect(() => {
    let gone = false;
    const root = document.documentElement;
    const tell = (light: boolean) =>
      root.toggleAttribute("data-paper-light", light);
    if (!shown) {
      // The bare ground: light or dark as the scheme is, and again when
      // the scheme changes under it.
      const read = () => tell(!root.classList.contains("dark"));
      read();
      const watch = new MutationObserver(read);
      watch.observe(root, { attributes: true, attributeFilter: ["class"] });
      return () => watch.disconnect();
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    // The strip of the picture that actually lies under the bar: the
    // picture covers the screen, centred, so at another aspect the top of
    // the file is not the top of the screen.
    const sample = () => {
      if (gone) return;
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const screen = window.innerWidth / window.innerHeight;
        const wide = w / h > screen;
        const visW = wide ? h * screen : w;
        const visH = wide ? h : w / screen;
        const x0 = (w - visW) / 2;
        const y0 = (h - visH) / 2;
        const c = document.createElement("canvas");
        c.width = 16;
        c.height = 2;
        const g = c.getContext("2d");
        if (!g) return;
        g.drawImage(img, x0, y0, visW, Math.max(1, visH * 0.05), 0, 0, 16, 2);
        const d = g.getImageData(0, 0, 16, 2).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4)
          sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
        tell(sum / (d.length / 4) > 150);
      } catch {
        tell(false);
      }
    };
    img.onload = sample;
    img.onerror = () => !gone && tell(false);
    img.src = shown;
    const resized = () => img.complete && sample();
    window.addEventListener("resize", resized);
    return () => {
      gone = true;
      window.removeEventListener("resize", resized);
    };
  }, [shown]);

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
    </div>
  );
}

// One page of the rail: a desktop with its windows where they were left, the
// spot a drag would land, and the desktop's own menu on
// a right-click or a long press.
function DesktopPage({
  page,
  narrow,
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
  // Whether this is a phone: every window the full width, moved and
  // resized up and down only, switched by a swipe on its title bar.
  narrow: boolean;
  // Whether the desktop keeps clear of the dock.
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
  const clear = clearOf(useDockIconSize(), away ?? "bottom");
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
  // On a phone the desktop ends where the keyboard begins, so what lies
  // along a window's bottom, the terminal's keys, the composer, rises with
  // it. ryOS leaves this to the browser; Safari does not shrink a pinned
  // page for its keyboard, so the visual viewport is read instead.
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    if (!narrow) return setRoom(null);
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => {
      const short = window.innerHeight - vv.height - vv.offsetTop > 80;
      setRoom(short ? vv.height + vv.offsetTop : null);
    };
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    measure();
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, [narrow]);
  // A point on the desktop under a point on the screen.
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
  // Where something sits on the desktop, in pixels: its share of the desktop,
  // held to the sizes its surface is worth being.
  const rectOf = (c: Box & Point, bounds?: Bounds) => {
    if (narrow) {
      // The full width, 8 in from either side (ryOS WindowFrame.tsx:268,277);
      // never above the top, at least 80 of it on screen
      // (useWindowManager.ts:298-306), and no taller than the app is worth
      // or the desktop has; the top stays where it is put.
      const least = Math.min(bounds?.min?.h ?? 0, size.h);
      const most = Math.min(bounds?.max?.h ?? Infinity, size.h);
      const top = between(c.y * size.h, 0, Math.max(0, size.h - 80));
      return {
        left: INSET,
        top,
        width: size.w - INSET * 2,
        height: Math.min(between(c.h * size.h, least, most), size.h - top),
      };
    }
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
  // The window before or after this one in the stack, brought to the
  // front: what a swipe on a phone's bar does (ryOS useAppStore's
  // navigateToNextInstance, cycling the instance order).
  const flip = (id: string, dir: 1 | -1) => {
    const order = page.cards.filter((c) => !c.minimized && !c.pinned);
    const i = order.findIndex((c) => c.id === id);
    const next = order[(i + dir + order.length) % order.length];
    if (!next || next.id === id) return;
    // A filled window stands over everything; it comes back to its place
    // so the next one can be seen.
    if (expanded === id) onCollapse();
    onFront(next.id);
  };
  // Where a window's middle is on the screen, for its flight to the dock
  // and back.
  const middle = (c: Card) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: r.left + (c.x + c.w / 2) * size.w,
      y: r.top + (c.y + c.h / 2) * size.h,
    };
  };

  return (
    <div
      data-page={page.key}
      className="relative h-full w-full"
      onDragOver={(e) => {
        if (!carrying.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onHover(pointAt(e.clientX, e.clientY));
      }}
      onDragLeave={(e) => {
        if (!box.current?.contains(e.relatedTarget as globalThis.Node))
          onHover(null);
      }}
      onDrop={(e) => {
        if (!carrying.current) return;
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
      {/* Bare desktop takes no clicks of its own, so a right-click there
          reaches the desktop's menu beneath; the windows take theirs. */}
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
          ...(room !== null && {
            bottom: "auto",
            height: `calc(${room}px - 25px - env(safe-area-inset-top))`,
          }),
        }}
      >
        <WindowFrameSnapZoneIndicator snapZoneStyle={glow()} />
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
                // A window is a box on the desktop in every state it has:
                // where it was left, where it was carried, the half it
                // was snapped to, or the whole desktop when it is filling
                // the screen, which means the whole of it: the most a
                // surface is worth being holds a window, not the screen.
                // Nothing teleports, because nothing ever changes how it
                // is placed — only its four numbers.
                const box = rectOf(
                  full ? WHOLE : c,
                  full ? { min: bounds.min } : bounds,
                );
                return (
                  <motion.div
                    key={c.id}
                    inert={c.minimized}
                    className="pointer-events-none absolute"
                    initial={false}
                    animate={box}
                    // A window let go, snapped or filled grows into its
                    // place; one being carried keeps up with the hand.
                    transition={carried || still ? { duration: 0 } : BASE}
                    style={{ zIndex: layer }}
                  >
                    <Frame
                      card={c}
                      narrow={narrow}
                      onSwitch={(dir) => flip(c.id, dir)}
                      computers={computers}
                      full={full}
                      front={
                        c.id ===
                        page.cards
                          .filter((x) => !x.minimized && !x.pinned)
                          .at(-1)?.id
                      }
                      minimized={!!c.minimized}
                      born={born.has(c.id)}
                      onArrived={() => born.delete(c.id)}
                      middle={() => middle(c)}
                      desktop={size}
                      at={pointAt}
                      onClose={() => onClose(c.id)}
                      onGuard={onGuard}
                      onMinimize={() =>
                        onShape(c.id, { minimized: true }, true)
                      }
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

// What in a bar is a control of its own, and not a place to take hold of
// the window by.
const CONTROL =
  "button, a, input, textarea, select, [role=button], [role=textbox], [contenteditable=true]";
// Where a double-click is the field's or the lights' own, not the bar's.
const TYPING =
  "input, textarea, select, [role=textbox], [contenteditable=true], [data-titlebar-controls]";

// One window's frame, drawn as ryOS draws one: three lights and its name
// in a bar to drag it by, every edge and corner to resize it by, and the
// surface itself. Touching it brings it to the front; it arrives from the
// dock and leaves for it. Our own pages frame as themselves; a port is a colleague's
// computer at another address and is sandboxed to reach nothing of this
// session.
function Frame({
  card,
  narrow,
  onSwitch,
  computers,
  full,
  front,
  born,
  minimized,
  onArrived,
  middle,
  desktop,
  at,
  onClose,
  onGuard,
  onMinimize,
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
  narrow: boolean;
  // The window before or after this one, brought to the front.
  onSwitch: (dir: 1 | -1) => void;
  computers: boolean;
  full: boolean;
  // Whether it is the window in front on its desktop.
  front: boolean;
  // Whether it was just opened from the dock, and the word that it has
  // arrived and is so no longer.
  born: boolean;
  // Minimized in the dock: shrunk into its mark there, still alive.
  minimized: boolean;
  onArrived: () => void;
  // Where its middle is on the screen.
  middle: () => { x: number; y: number } | null;
  desktop: { w: number; h: number };
  at: (clientX: number, clientY: number) => { x: number; y: number } | null;
  onClose: () => void;
  onGuard: (key: string, ask: (() => Promise<boolean>) | null) => void;
  onMinimize: () => void;
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
  const free = !full;
  // On the desktop as a widget: a strip of its own to move it by instead of
  // a bar, and a menu there for making it a window or taking it off.
  const widget = !!card.pinned;
  // The most this window is worth drawing at; a widget is whatever size
  // it was put down at.
  const bounds = boundsOf(card);
  const Panel = PANELS[pathOf(card.href)];
  // Where the panel's own controls go, in the bar after the name.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [lead, setLead] = useState<HTMLDivElement | null>(null);
  // On a phone the title bar is narrow: a panel's toolbar controls fold
  // into a strip under it and into a sheet the title bar's last button
  // opens.
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sheetSlot, setSheetSlot] = useState<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // The panel's own way to hold this window open while it asks something.
  const beforeClose = useCallback(
    (ask: (() => Promise<boolean>) | null) => onGuard(card.id, ask),
    [onGuard, card.id],
  );

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
    if (e.button !== 0 || !free || desktop.w <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const from = { x: e.clientX, y: e.clientY };
    // Taken hold of where it is drawn, which for a held window is
    // not where its numbers say: from here on the two agree.
    const was = fit(card, desktop, bounds);
    // The least and the most it may be pulled to, as shares of this desktop,
    // neither of them more than the desktop itself.
    const most = {
      w: Math.min(1, (bounds.max?.w ?? Infinity) / desktop.w),
      h: Math.min(1, (bounds.max?.h ?? Infinity) / desktop.h),
    };
    const least = {
      w: Math.min(most.w, (bounds.min.w ?? 0) / desktop.w),
      h: Math.min(most.h, (bounds.min.h ?? 0) / desktop.h),
    };
    onCarry(true);
    const to = (m: globalThis.PointerEvent): Partial<Card> => {
      const dx = (m.clientX - from.x) / desktop.w;
      const dy = (m.clientY - from.y) / desktop.h;
      // On a phone a window moves up and down only, never above the top,
      // never so far down that less than 80 of it shows
      // (ryOS useWindowManager.ts:298-306).
      if (what === "move" && narrow)
        return {
          ...was,
          x: 0,
          y: between(was.y + dy, 0, Math.max(0, 1 - 80 / desktop.h)),
        };
      if (what === "move") return { ...was, x: was.x + dx, y: was.y + dy };
      // The side being pulled goes where the hand is, as far as the desktop,
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
      // No snapping on a phone (useWindowManager.ts:301).
      if (what !== "move" || narrow) return null;
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
  // The bar hears a press on the element itself rather than through React:
  // a panel's controls are portaled into the bar, so in React's tree their
  // presses never reach it, and the path a Files window shows would cover
  // the whole bar. A press on a control is the control's own; any other
  // press on the bar takes hold of the window.
  const move = useRef(drag);
  move.current = drag;
  const toggle = useRef(full ? onCollapse : onExpand);
  toggle.current = full ? onCollapse : onExpand;
  const filled = useRef(full);
  filled.current = full;
  // A filled window pulled by its bar comes back down under the pointer,
  // the same way along its own bar as the pointer was along the full
  // one, and is carried from there.
  const shape = useRef(onShape);
  shape.current = onShape;
  const held = useRef(card);
  // The last tap on a resize edge, and the height a window had before a
  // double-tap on one made it as tall as the desktop.
  const edgeTap = useRef(0);
  const shortly = useRef(card.h);
  held.current = card;
  const turn = useRef(onSwitch);
  turn.current = onSwitch;
  const [nudge, setNudge] = useState(0);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bar) return;
    // A second tap within 300ms fills or restores, as ryOS's title bar
    // does (useWindowFrameMaximize.ts:233-269).
    let lastTap = 0;
    // A fill just made is left alone for a moment, so a third tap does not
    // undo it mid-flight (ryOS useWindowFrameMaximize.ts:240-242).
    let toggled = 0;
    // A swipe across the title bar of more than 100px brings the next or
    // the previous window, nudging the window 10px the way the finger
    // went meanwhile (ryOS useSwipeNavigation.ts:80-118, windowFrameUtils.ts:10-25).
    let swipe: { id: number; x: number } | null = null;
    // A filled window is pulled down once the hand has moved a few
    // pixels, then carried as any window is; a finger has to mean it,
    // more down than across, since across is the swipe to the next window.
    let pull: { id: number; x: number; y: number; touch: boolean } | null =
      null;
    const down = (e: globalThis.PointerEvent) => {
      if ((e.target as Element | null)?.closest(CONTROL)) return;
      if (e.pointerType === "touch") {
        const now = Date.now();
        if (now - toggled < 300) return;
        if (now - lastTap < 300) {
          lastTap = 0;
          toggled = now;
          buzz(50);
          toggle.current();
          return;
        }
        lastTap = now;
        swipe = { id: e.pointerId, x: e.clientX };
        if (filled.current)
          pull = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: true };
        else move.current("move")(e as unknown as PointerEvent<HTMLDivElement>);
        return;
      } else if (filled.current && e.button === 0) {
        pull = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: false };
        return;
      }
      move.current("move")(e as unknown as PointerEvent<HTMLDivElement>);
    };
    const pulled = (e: globalThis.PointerEvent) => {
      if (!pull || e.pointerId !== pull.id) return;
      const dx = e.clientX - pull.x;
      const dy = e.clientY - pull.y;
      if (pull.touch) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > dy) return void (pull = null);
        if (dy < 12) return;
      } else if (Math.hypot(dx, dy) < 4) return;
      swipe = null;
      pull = null;
      const rect = bar.getBoundingClientRect();
      const along = between((e.clientX - rect.left) / rect.width, 0, 1);
      const was = held.current;
      toggle.current();
      shape.current({ ...was, x: along * (1 - was.w), y: 0 }, false);
      // Carried once the window is drawn back down.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          move.current("move")({
            button: 0,
            pointerId: e.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
            currentTarget: bar,
            preventDefault() {},
            stopPropagation() {},
          } as unknown as PointerEvent<HTMLDivElement>),
        ),
      );
    };
    const unpull = (e: globalThis.PointerEvent) => {
      if (pull && e.pointerId === pull.id) pull = null;
    };
    const across = (e: globalThis.PointerEvent) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x;
      setNudge(Math.abs(dx) > 20 ? (dx > 0 ? 10 : -10) : 0);
    };
    const up = (e: globalThis.PointerEvent) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x;
      swipe = null;
      setNudge(0);
      if (Math.abs(dx) > 100) {
        buzz(30);
        turn.current(dx < 0 ? 1 : -1);
      }
    };
    const twice = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest(TYPING)) return;
      toggle.current();
    };
    bar.addEventListener("pointerdown", down);
    bar.addEventListener("pointermove", across);
    bar.addEventListener("pointermove", pulled);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointerup", unpull);
    bar.addEventListener("pointercancel", up);
    bar.addEventListener("pointercancel", unpull);
    bar.addEventListener("dblclick", twice);
    return () => {
      bar.removeEventListener("pointerdown", down);
      bar.removeEventListener("pointermove", across);
      bar.removeEventListener("pointermove", pulled);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointerup", unpull);
      bar.removeEventListener("pointercancel", up);
      bar.removeEventListener("pointercancel", unpull);
      bar.removeEventListener("dblclick", twice);
    };
  }, [bar]);

  // The way from this window's middle to a mark in the dock.
  const flight = (el: Element | null) => {
    const m = middle();
    if (!el || !m) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - m.x, y: r.top + r.height / 2 - m.y };
  };
  const own = () =>
    document.querySelector(`[data-dock-icon="${CSS.escape(card.id)}"]`);
  // How it arrives: out of its own mark in the dock when it was minimized,
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

  // Minimized, the window shrinks into its mark in the dock and stays
  // there, mounted, so what it holds is not lost; measured a frame later,
  // once the dock has made room for the mark.
  const [away, setAway] = useState<TargetAndTransition | null>(null);
  useEffect(() => {
    if (!minimized) return setAway(null);
    const frame = requestAnimationFrame(() =>
      setAway(getExitAnimation(() => flight(own()), !!still)),
    );
    return () => cancelAnimationFrame(frame);
  }, [minimized]);

  return (
    <motion.div
      initial={arrival}
      animate={
        (minimized && away) || {
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
      <div
        data-window
        data-front={front ? "" : undefined}
        onPointerDownCapture={onFront}
        className={`glass-pane @container relative flex h-full flex-col overflow-hidden rounded-[12px] ${
          minimized ? "pointer-events-none" : "pointer-events-auto"
        }`}
        style={
          {
            // A widget lies on the desktop and casts nothing; a window casts
            // the one shadow every window has (ryOS tokens.css:204).
            "--pane-cast": widget ? "none" : "0 3px 10px rgba(0, 0, 0, 0.3)",
            ...(nudge && {
              transform: `translateX(${nudge}px)`,
              transition: "transform 0.1s ease",
            }),
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
                Take off the desktop
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          <div
            ref={setBar}
            className="group/bar relative flex h-6 shrink-0 cursor-move touch-none items-center select-none [&:has([data-nameless])_[data-name]]:hidden"
          >
            {/* A grip, shown while the pointer is on the bar. */}
            <span
              aria-hidden
              className="bg-foreground-icon-tertiary ease-plain duration-fast pointer-events-none absolute top-[3px] left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover/bar:opacity-60"
            />
            <div
              className="group/traffic relative ml-1.5 flex items-center gap-2"
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
                onClick={onMinimize}
                isForeground={front}
                ariaLabel="Minimize"
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
            {Panel && !narrow && (
              <div
                ref={setLead}
                data-controls
                className="ml-2 flex min-w-0 shrink items-center gap-1 empty:hidden"
              />
            )}
            {/* The name in the middle of the bar, as a Mac's is, over
                nothing: the panel's controls keep to the right of it. */}
            <span
              data-name
              className={`pointer-events-none absolute left-1/2 max-w-[calc(100%-140px)] -translate-x-1/2 truncate text-body-2-medium ${
                front ? "text-text-primary" : "text-text-secondary"
              }`}
              style={{ textShadow: "var(--title-shadow)" }}
            >
              {card.title}
            </span>
            {Panel && !narrow && (
              // The last control ends 14 from the edge: its 10 corner sits
              // inside the window's 24 as one curve, and clear of it.
              <div
                ref={setSlot}
                data-controls
                className="mr-3.5 ml-3 flex min-w-0 flex-1 items-center justify-end gap-2"
              />
            )}
            {Panel && narrow && (
              // On a phone the panel's controls are behind one button, as a
              // sheet of rows a thumb can hit.
              <BarButton
                icon={RiMoreLine}
                label="More"
                pressed={sheet}
                onClick={() => setSheet(true)}
                className="mr-1.5 ml-auto"
              />
            )}
          </div>
        )}
        {Panel && narrow && !widget && (
          // What a panel keeps in view on a phone, a path or an address,
          // in a strip of its own under the title bar.
          <div
            ref={setStrip}
            data-controls
            className="flex h-[34px] shrink-0 items-center gap-2 overflow-x-auto border-b border-separator-border px-3 [scrollbar-width:none] empty:hidden [&::-webkit-scrollbar]:hidden"
          />
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
                controls: narrow ? sheetSlot : slot,
                leading: lead,
                strip: narrow ? strip : null,
                phone: narrow,
                beforeClose,
              }}
            >
              <Panel fresh={fresh.current} id={card.id} href={card.href} />
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
      {/* Outside the pane, which clips what it holds, so each resize
          handle straddles the frame. On a phone only the top and bottom
          handles, thicker for a thumb (ryOS WindowFrameResizeHandles.tsx:
          44-72: the side and corner handles are hidden below md). */}
      {free &&
        (narrow ? PHONE_EDGES : EDGES).map(([edge, where]) => (
          <div
            key={edge}
            aria-hidden
            onPointerDown={(e) => {
              // On a phone a double-tap on an edge makes the window as
              // tall as the desktop, and the next brings its height back
              // (ryOS useWindowFrameMaximize.ts:70-110).
              if (narrow && e.pointerType === "touch") {
                const now = Date.now();
                if (now - edgeTap.current < 300) {
                  edgeTap.current = 0;
                  const was = held.current;
                  const tall = was.y === 0 && was.h >= 0.98;
                  if (!tall) shortly.current = was.h;
                  shape.current(
                    tall
                      ? { ...was, h: shortly.current }
                      : { ...was, y: 0, h: 1 },
                    true,
                  );
                  buzz(50);
                  return;
                }
                edgeTap.current = now;
              }
              drag(edge)(e);
            }}
            className={`pointer-events-auto absolute z-10 touch-none ${where}`}
          />
        ))}
      {Panel && narrow && (
        <PhoneSheet
          open={sheet}
          onClose={() => setSheet(false)}
          label={card.title}
          bodyRef={setSheetSlot}
          controls
        />
      )}
    </motion.div>
  );
}
