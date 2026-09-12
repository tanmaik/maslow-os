"use client";

import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  Bars2Icon,
  BookmarkIcon,
  BookmarkSlashIcon,
  PlusIcon,
  WindowIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { useReducedMotion } from "motion/react";
import {
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
import { Terminal } from "@/app/computer/terminal/terminal";
import { BLOCKS, boxOf, markOf, type Block } from "@/app/room/blocks";
import { BarSlot } from "@/app/room/panel";
import { You } from "@/components/you";

// Whether the dock is kept in view, remembered on this device.
const PINNED = "maslow.dock.pinned";
import {
  cascade,
  clamp,
  fresh,
  type Box,
  type Card,
  type Desktop,
  type Port,
  type Screen,
} from "@/app/room/tiles";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// What is carried while a block is dragged from the toolbar: what it
// frames and the size it opens at.
const DRAG = "application/x-maslow-card";
type Dragged = { kind: Card["kind"]; title: string; href: string; box: Box };

// A point on the desk, as shares of its width and height.
type Point = { x: number; y: number };

const EMPTY: Screen = { cards: [] };
const isPort = (t: { kind: Card["kind"] }) => t.kind === "port";

// The surfaces that are panels: drawn in the window itself, their
// controls in its bar. Every other surface is framed as the page it is.
const PANELS: Record<string, ComponentType> = {
  "/computer/terminal": Terminal,
  "/computer/files": Finder,
  "/browser": LiveBrowser,
};

// One page of the rail: a desk on a wide display, or one of its windows on
// a phone, where each window is a page of its own.
type Page = { id: string; key: string; layout: Screen; cards: Card[] };

// Who is at the desk, for the dock's end: their picture or initials, and
// under it the other orgs they are in, a new org, and the way out.
type Me = {
  name: string;
  email: string;
  picture: string | null;
  others: { userId: string; orgName: string }[];
};

export function Room({
  desktops: given,
  ports,
  waiting,
  you,
}: {
  desktops: Desktop[];
  ports: Port[];
  // How much asks something of the person and is still there.
  waiting: number;
  you: Me | undefined;
}) {
  const [desktops, setDesktops] = useState(given);
  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  // A block picked from the toolbar, waiting to be put down where the
  // person clicks.
  const carrying = useRef<Dragged | null>(null);
  // While anything is dragged, the windows' frames stop taking the
  // pointer: a frame would swallow the drag as its own.
  const [carried, setCarried] = useState(false);
  const [preview, setPreview] = useState<{ id: string; at: Point } | null>(
    null,
  );
  const rail = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();

  // The dock stays where it is while pinned; unpinned, it hides and the
  // desk takes the whole page, and a tab at the bottom edge brings it
  // back for a moment.
  const [pinned, setPinned] = useState(true);
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    setPinned(localStorage.getItem(PINNED) !== "no");
  }, []);
  const pin = (to: boolean) => {
    setPinned(to);
    setPeek(false);
    localStorage.setItem(PINNED, to ? "yes" : "no");
  };
  const dock = pinned || peek;

  const [wide, setWide] = useState(true);
  useEffect(() => {
    const q = matchMedia("(min-width: 640px)");
    const read = () => setWide(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);

  // Escape brings an expanded window back down.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setExpanded(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const screens = desktops.map((d) => ({ ...d, layout: d.layout ?? EMPTY }));
  const pages: Page[] = screens.flatMap((s) =>
    wide || s.layout.cards.length === 0
      ? [{ id: s.id, key: s.id, layout: s.layout, cards: s.layout.cards }]
      : s.layout.cards.map((c) => ({
          id: s.id,
          key: `${s.id}:${c.id}`,
          layout: s.layout,
          cards: [c],
        })),
  );

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

  const persist = async (id: string, layout: Screen) => {
    await fetch("/room/desktop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, layout }),
    });
  };
  const setScreen = (id: string, layout: Screen, save = true) => {
    setDesktops((was) => was.map((d) => (d.id === id ? { ...d, layout } : d)));
    if (save) void persist(id, layout);
  };

  // A new desk after the last, holding these windows, and the rail taken
  // to it.
  const addScreen = async (cards: Card[] = []) => {
    const res = await fetch("/room/desktop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: { cards } }),
    });
    if (!res.ok) return;
    const made = (await res.json()) as Desktop;
    setDesktops((was) => [...was, made]);
    requestAnimationFrame(() => goTo(pages.length));
  };

  // A block landing on a desk: a new window at the block's own size,
  // where the person pointed or where a cascade puts it, in front of the
  // rest. The same block may be open as many times as they like.
  const land = async (item: Dragged, id: string | "new", at?: Point) => {
    const open = (cards: Card[]): Card =>
      clamp({
        id: fresh(),
        kind: item.kind,
        title: item.title,
        href: item.href,
        ...item.box,
        ...(at ?? cascade(cards, item.box)),
      });
    if (id === "new") {
      await addScreen([open([])]);
      return;
    }
    const s = screens.find((x) => x.id === id);
    if (!s) return;
    setScreen(id, { cards: [...s.layout.cards, open(s.layout.cards)] });
  };

  const close = (id: string, key: string) => {
    const s = screens.find((x) => x.id === id);
    if (!s) return;
    if (expanded === key) setExpanded(null);
    setScreen(id, { cards: s.layout.cards.filter((c) => c.id !== key) });
  };

  // A window changed by hand: moved or resized, live while the pointer is
  // down and kept when it lifts.
  const shape = (id: string, key: string, to: Partial<Card>, save: boolean) => {
    const s = screens.find((x) => x.id === id);
    if (!s) return;
    setScreen(
      id,
      {
        cards: s.layout.cards.map((c) =>
          c.id === key ? clamp({ ...c, ...to }) : c,
        ),
      },
      save,
    );
  };

  // A window touched comes to the front.
  const front = (id: string, key: string) => {
    const s = screens.find((x) => x.id === id);
    if (!s || s.layout.cards.at(-1)?.id === key) return;
    const c = s.layout.cards.find((x) => x.id === key);
    if (!c) return;
    setScreen(id, {
      cards: [...s.layout.cards.filter((x) => x.id !== key), c],
    });
  };

  const removeScreen = async (id: string) => {
    if (desktops.length <= 1) return;
    setDesktops((was) => was.filter((d) => d.id !== id));
    await fetch("/room/desktop", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

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

  // A block picked from the toolbar opens on the desk in view.
  const pick = (b: Dragged) => {
    const p = pages[Math.min(current, pages.length - 1)];
    void land(b, p?.id ?? "new");
  };

  return (
    <>
      <div className="bg-background fixed inset-0" />
      <div
        ref={rail}
        onScroll={track}
        className={`fixed inset-0 z-10 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          carried ? "[&_iframe]:pointer-events-none" : ""
        }`}
      >
        {pages.map((p) => (
          <Desk
            key={p.key}
            page={p}
            wide={wide}
            dock={dock}
            carrying={carrying}
            preview={preview?.id === p.id ? preview.at : null}
            expanded={expanded}
            onHover={(at) =>
              setPreview((was) =>
                at ? { id: p.id, at } : was?.id === p.id ? null : was,
              )
            }
            onDrop={(at) => {
              const item = carrying.current;
              end();
              if (item) void land(item, p.id, at);
            }}
            onClose={(key) => close(p.id, key)}
            onShape={(key, to, save) => shape(p.id, key, to, save)}
            onFront={(key) => front(p.id, key)}
            onCarry={setCarried}
            onExpand={setExpanded}
            onCollapse={() => setExpanded(null)}
            onRemove={
              desktops.length > 1 && p.layout.cards.length === 0
                ? () => removeScreen(p.id)
                : undefined
            }
            onNew={() => void addScreen()}
          />
        ))}
        <NewSlide
          carrying={carrying}
          dock={dock}
          onDrop={() => {
            const item = carrying.current;
            end();
            if (item) void land(item, "new");
          }}
        />
      </div>

      <Dots
        count={pages.length}
        current={current}
        wide={wide}
        dock={dock}
        onGo={goTo}
      />
      {dock ? (
        <Toolbar
          wide={wide}
          ports={ports}
          waiting={waiting}
          you={you}
          pinned={pinned}
          onPin={() => pin(!pinned)}
          onLeave={() => setPeek(false)}
          onBegin={begin}
          onEnd={end}
          onPick={(b) => {
            setPeek(false);
            pick(b);
          }}
        />
      ) : (
        <button
          type="button"
          aria-label="Show the dock"
          onPointerEnter={wide ? () => setPeek(true) : undefined}
          onClick={() => setPeek(true)}
          className="bg-background text-muted-foreground fixed bottom-0 left-1/2 z-40 flex h-4 w-16 -translate-x-1/2 items-center justify-center border border-b-0"
        >
          <Bars2Icon className="size-3" />
        </button>
      )}
    </>
  );
}

// One page of the rail: a desk with its windows where they were left, the
// spot a drag would land, and the desk's own menu on
// a right-click or a long press.
function Desk({
  page,
  wide,
  dock,
  carrying,
  preview,
  expanded,
  onHover,
  onDrop,
  onClose,
  onShape,
  onFront,
  onCarry,
  onExpand,
  onCollapse,
  onRemove,
  onNew,
}: {
  page: Page;
  wide: boolean;
  dock: boolean;
  carrying: React.RefObject<Dragged | null>;
  preview: Point | null;
  expanded: string | null;
  onHover: (at: Point | null) => void;
  onDrop: (at: Point) => void;
  onClose: (key: string) => void;
  onShape: (key: string, to: Partial<Card>, save: boolean) => void;
  onFront: (key: string) => void;
  onCarry: (carrying: boolean) => void;
  onExpand: (key: string) => void;
  onCollapse: () => void;
  onRemove?: () => void;
  onNew: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
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
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / size.w)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / size.h)),
    };
  };
  const rectOf = (c: Card) => ({
    left: c.x * size.w,
    top: c.y * size.h,
    width: c.w * size.w,
    height: c.h * size.h,
  });

  // What is about to land: the carried block where it is over the desk.
  const landing =
    preview && carrying.current
      ? { at: preview, item: carrying.current }
      : null;
  const ghost = landing
    ? rectOf(
        clamp({
          id: "ghost",
          kind: landing.item.kind,
          title: landing.item.title,
          href: landing.item.href,
          ...landing.item.box,
          ...landing.at,
        }),
      )
    : null;

  return (
    <div
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
        if (at) onDrop(at);
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger className="absolute inset-0" />
        <ContextMenuContent>
          <ContextMenuItem onClick={onNew}>New desk</ContextMenuItem>
          {onRemove && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={onRemove}>
                Remove this desk
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <div
        ref={box}
        className={`absolute inset-2.5 max-sm:top-[calc(env(safe-area-inset-top)+3.75rem)] ${
          dock
            ? "sm:bottom-[5.25rem] max-sm:bottom-[calc(env(safe-area-inset-bottom)+6.5rem)]"
            : "max-sm:bottom-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        }`}
      >
        {ghost && (
          <div
            className="border-primary/60 bg-primary/5 pointer-events-none absolute z-10 border-2 border-dashed"
            style={ghost}
          />
        )}
        {size.h > 0 &&
          page.cards.map((c) => {
            const full = expanded === c.id;
            return (
              <div
                key={c.id}
                className={
                  full
                    ? `fixed inset-0 z-50 max-sm:pt-[env(safe-area-inset-top)] ${dock ? "sm:pb-[4.75rem] max-sm:pb-[calc(env(safe-area-inset-bottom)+4.75rem)]" : "max-sm:pb-[env(safe-area-inset-bottom)]"}`
                    : "absolute"
                }
                style={full ? undefined : wide ? rectOf(c) : { inset: 0 }}
              >
                <Frame
                  card={c}
                  full={full}
                  wide={wide}
                  desk={size}
                  onClose={() => onClose(c.id)}
                  onShape={(to, save) => onShape(c.id, to, save)}
                  onFront={() => onFront(c.id)}
                  onCarry={onCarry}
                  onExpand={() => onExpand(c.id)}
                  onCollapse={onCollapse}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

// The page past the last: drop a block here and a new desk is made
// holding it.
function NewSlide({
  carrying,
  dock,
  onDrop,
}: {
  carrying: React.RefObject<Dragged | null>;
  dock: boolean;
  onDrop: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="relative h-full w-full shrink-0 snap-start"
      onDragOver={(e) => {
        if (!carrying.current) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!carrying.current) return;
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
    >
      <div
        className={`text-muted-foreground absolute inset-2.5 grid place-items-center border-2 border-dashed text-sm ${dock ? "sm:bottom-[5.25rem]" : ""} ${
          over
            ? "border-primary/60 bg-primary/5 text-foreground"
            : "border-border"
        }`}
      >
        <span className="flex items-center gap-2">
          <PlusIcon className="size-4" /> Drop a block here for a new desk
        </span>
      </div>
    </div>
  );
}

// Which page is in view, one dot each, just above the toolbar.
function Dots({
  count,
  current,
  wide,
  dock,
  onGo,
}: {
  count: number;
  current: number;
  wide: boolean;
  dock: boolean;
  onGo: (i: number) => void;
}) {
  if (count < 2) return null;
  return (
    <div
      className={`bg-background fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 border px-2.5 py-1.5 ${
        !dock
          ? "bottom-5"
          : wide
            ? "bottom-[4.25rem]"
            : "bottom-[calc(env(safe-area-inset-bottom)+5.25rem)]"
      }`}
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Desk ${i + 1}`}
          onClick={() => onGo(i)}
          className={`size-2 rounded-full ${
            i === current ? "bg-foreground" : "bg-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

// The dock: every block as a mark, along the bottom. A click opens the
// block in a new window on the desk, as many times as the person likes;
// a drag opens it where it is dropped. After the blocks, the pin that
// keeps it in view or lets it hide, and you. What waits on you is a
// count on the Brain.
function Toolbar({
  wide,
  ports,
  waiting,
  you,
  pinned,
  onPin,
  onLeave,
  onBegin,
  onEnd,
  onPick,
}: {
  wide: boolean;
  ports: Port[];
  waiting: number;
  you: Me | undefined;
  pinned: boolean;
  onPin: () => void;
  onLeave: () => void;
  onBegin: (item: Dragged) => (e: DragEvent) => void;
  onEnd: () => void;
  onPick: (b: Dragged) => void;
}) {
  const one = (b: Block): ReactNode => {
    const Mark = b.mark;
    const item: Dragged = {
      kind: b.kind,
      title: b.title,
      href: b.href,
      box: b.box,
    };
    const button = (
      <Button
        variant="ghost"
        size="icon"
        draggable
        aria-label={b.title}
        onDragStart={onBegin(item)}
        onDragEnd={onEnd}
        onClick={() => onPick(item)}
        className="text-foreground relative size-10 rounded-none"
      >
        <Mark className="size-[18px]" />
        {b.href === "/brain" && waiting > 0 && (
          <span
            aria-label={`${waiting} waiting on you`}
            className="bg-primary text-primary-foreground absolute top-1 right-1 grid size-4 place-items-center rounded-full text-[10px] font-semibold"
          >
            {waiting}
          </span>
        )}
      </Button>
    );
    return wide ? (
      <Tooltip key={b.href}>
        <TooltipTrigger render={button} />
        <TooltipContent side="top">{b.title}</TooltipContent>
      </Tooltip>
    ) : (
      <span key={b.href}>{button}</span>
    );
  };
  return (
    <div
      onPointerLeave={!pinned && wide ? onLeave : undefined}
      className="bg-background fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto border p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="contents">
        <TooltipProvider>
          {BLOCKS.map(one)}
          {ports.length > 0 && (
            <Separator orientation="vertical" className="mx-1 h-6" />
          )}
          {ports.map((p) =>
            one({
              kind: "port",
              ...p,
              mark: WindowIcon,
              box: boxOf({ kind: "port", href: p.href }),
            }),
          )}
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={pinned ? "Let the dock hide" : "Keep the dock"}
            aria-pressed={pinned}
            onClick={onPin}
            className="text-muted-foreground size-10 rounded-none"
          >
            {pinned ? (
              <BookmarkSlashIcon className="size-[18px]" />
            ) : (
              <BookmarkIcon className="size-[18px]" />
            )}
          </Button>
          {you && (
            <span className="grid size-10 shrink-0 place-items-center">
              <You {...you} />
            </span>
          )}
        </TooltipProvider>
      </div>
    </div>
  );
}

// One window's frame: its mark and name to drag it by, a corner to resize
// it by, a way to fill the screen with it and to bring it back, a way to
// take it down, and the surface itself. Touching it brings it to the
// front. Our own pages frame as themselves; a port is a colleague's
// computer at another address and is sandboxed to reach nothing of this
// session.
function Frame({
  card,
  full,
  wide,
  desk,
  onClose,
  onShape,
  onFront,
  onCarry,
  onExpand,
  onCollapse,
}: {
  card: Card;
  full: boolean;
  wide: boolean;
  desk: { w: number; h: number };
  onClose: () => void;
  onShape: (to: Partial<Card>, save: boolean) => void;
  onFront: () => void;
  onCarry: (carrying: boolean) => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const Mark = markOf(card);
  const free = wide && !full;
  const Panel = PANELS[card.href];
  // Where the panel's own controls go, in the bar after the name.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  // A drag by the bar moves the window; a drag by the corner resizes it.
  // The pointer is held until it lifts, so a fast hand never loses it.
  const drag = (what: "move" | "size") => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !free || desk.w <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const from = { x: e.clientX, y: e.clientY };
    const was = { ...card };
    onFront();
    onCarry(true);
    const to = (m: globalThis.PointerEvent): Partial<Card> => {
      const dx = (m.clientX - from.x) / desk.w;
      const dy = (m.clientY - from.y) / desk.h;
      return what === "move"
        ? { x: was.x + dx, y: was.y + dy }
        : { w: was.w + dx, h: was.h + dy };
    };
    const onMove = (m: globalThis.PointerEvent) => onShape(to(m), false);
    const onUp = (m: globalThis.PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      onShape(to(m), true);
      onCarry(false);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="bg-card relative flex h-full flex-col overflow-hidden border">
      <div
        onPointerDown={free ? drag("move") : undefined}
        onDoubleClick={full ? onCollapse : onExpand}
        onClick={!wide && !full ? onExpand : undefined}
        className={`bg-card flex h-9 shrink-0 items-center gap-1.5 border-b pr-1 pl-3 select-none ${
          free ? "cursor-grab touch-none active:cursor-grabbing" : ""
        }`}
      >
        <Mark className="text-muted-foreground size-4 shrink-0" />
        <span
          className={`truncate text-sm font-medium ${Panel ? "shrink-0" : "min-w-0 flex-1"}`}
        >
          {card.title}
        </span>
        {Panel && (
          <div
            ref={setSlot}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex min-w-0 flex-1 items-center gap-1 pl-2"
          />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={full ? "Back to its place" : "Fill the screen"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            (full ? onCollapse : onExpand)();
          }}
        >
          {full ? <ArrowsPointingInIcon /> : <ArrowsPointingOutIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Take it down"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <XMarkIcon />
        </Button>
      </div>
      {Panel ? (
        <div
          onPointerDownCapture={onFront}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <BarSlot value={slot}>
            <Panel />
          </BarSlot>
        </div>
      ) : (
        <iframe
          src={card.href}
          title={card.title}
          onFocus={onFront}
          className="min-h-0 flex-1 bg-white"
          sandbox={
            isPort(card)
              ? "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              : undefined
          }
        />
      )}
      {free && (
        <div
          aria-hidden
          onPointerDown={drag("size")}
          className="absolute right-0 bottom-0 z-10 size-4 cursor-nwse-resize touch-none"
        />
      )}
    </div>
  );
}
