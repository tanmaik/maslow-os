"use client";

import { RiCloseLine, RiMoreLine, RiWindowLine } from "@remixicon/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { BLOCKS, pathOf, type Block } from "@/app/room/blocks";
import type { Dragged } from "@/app/room/dock";
import { BarSlot } from "@/app/room/panel";
import { PhoneSheet, SheetRow } from "@/app/room/sheet";
import type { Card, Port } from "@/app/room/tiles";
import { Notification } from "@/components/base/notification/notification";
import { FAST } from "@/lib/motion";
import { cx } from "@/utils/cx";

// The phone: the same windows the desk has, worn the way a phone wears
// apps. Home is a screen of icons, the dock's apps and every port beside
// them, with the widgets laid as tiles above; a tap opens one edge to
// edge, into the notch and down to the home bar, with nothing to drag and
// nothing to resize; one handle of our own, a short pill above the phone's
// own, goes home on a tap and shows the recents on a swipe up; the recents
// are the open windows as a deck of cards, a tap to one, a flick up to
// close it. None of it lies where the phone's own gestures do.

type Panel = ComponentType<{ fresh?: boolean; id?: string; href?: string }>;

// How far a thumb travels up the handle before it means the recents.
const LIFT = 40;

// A block as the dock would hand it over.
const drag = (b: Block): Dragged => ({
  kind: b.kind,
  title: b.title,
  href: b.href,
  box: b.box,
});
const portDrag = (p: Port): Dragged => ({
  kind: "port",
  title: p.title,
  href: p.href,
  box: { w: 0.5, h: 0.5 },
});

export function Phone({
  cards,
  ports,
  computers,
  panels,
  onOpen,
  onAnother,
  onFront,
  onClose,
  onGuard,
  born,
  afresh,
}: {
  cards: Card[];
  ports: Port[];
  computers: boolean;
  panels: Record<string, Panel>;
  // An app as the dock opens it: its last window forward, or a first one.
  onOpen: (b: Dragged) => void;
  // Another window of the one in front.
  onAnother: (card: Card) => void;
  onFront: (card: Card) => void;
  onClose: (key: string) => void;
  onGuard: (key: string, ask: (() => Promise<boolean>) | null) => void;
  // The windows opened this moment, which start something new rather
  // than joining what was there.
  born: Set<string>;
  // A count per port window of the times its port came back, each a reload.
  afresh: Record<string, number>;
}) {
  const still = useReducedMotion();
  const windows = cards.filter((c) => !c.pinned);
  const widgets = cards.filter((c) => c.pinned);
  // The window in front is the last one raised: the desk keeps them in
  // that order.
  const front = windows.filter((c) => !c.stowed).at(-1) ?? null;
  const [view, setView] = useState<"home" | "app" | "recents">("home");
  // A tap on an icon opens or raises a window; the app is shown the
  // moment the front window is that app's.
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || !front) return;
    if (pathOf(front.href) === wanted) {
      setWanted(null);
      setView("app");
    }
  }, [wanted, front]);
  // A window the desk put in front from elsewhere, the command bar or a
  // menu, is shown as well; not while the recents are up, where a flick
  // away changes the front too.
  const was = useRef(front?.id ?? null);
  useEffect(() => {
    if (front && front.id !== was.current && view !== "recents") setView("app");
    was.current = front?.id ?? null;
  }, [front?.id]);
  // An app whose window closed under it is no longer in view.
  useEffect(() => {
    if (view === "app" && !front) setView("home");
  }, [view, front]);

  const open = (b: Dragged) => {
    setWanted(pathOf(b.href));
    onOpen(b);
  };
  const go = (c: Card) => {
    onFront(c);
    setWanted(pathOf(c.href));
  };

  // The handle: a tap goes home, a swipe up shows the recents.
  const touch = useRef<{ y: number; id: number } | null>(null);
  const handleDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    touch.current = { y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    if (t.y - e.clientY > LIFT) setView("recents");
    else setView("home");
  };
  const handle = (
    <button
      type="button"
      aria-label={
        view === "app" ? "Home, or swipe up for the open windows" : "Home"
      }
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={() => (touch.current = null)}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+2px)] left-1/2 z-[60] grid h-9 w-40 -translate-x-1/2 cursor-pointer place-items-center touch-none outline-none"
    >
      <span
        aria-hidden
        className="h-1.5 w-28 rounded-full bg-white/70 shadow-[0_1px_2px_rgb(0_0_0/0.4)]"
      />
    </button>
  );

  return (
    <>
      {/* Home: the widgets as tiles, then every app and every port. */}
      <div
        aria-hidden={view !== "home"}
        className={cx(
          "fixed inset-0 z-10 overflow-y-auto overscroll-y-contain px-5 pt-[calc(env(safe-area-inset-top)+25px+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+4rem)] transition-opacity duration-fast ease-plain",
          view === "home" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {widgets.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-4">
            {widgets.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() =>
                  open({
                    kind: w.kind,
                    title: w.title,
                    href: w.href,
                    box: { w: 0.5, h: 0.5 },
                  })
                }
                className="glass-pane flex aspect-square flex-col justify-between rounded-3xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                <RiWindowLine
                  className="size-6 text-foreground-icon-secondary"
                  aria-hidden
                />
                <span className="text-body-medium text-text-primary">
                  {w.title}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-4 gap-x-3 gap-y-6">
          {BLOCKS.map((b) => (
            <Icon
              key={b.href}
              title={b.title}
              face={b.face}
              onClick={() => open(drag(b))}
            />
          ))}
          {ports.map((p) => (
            <Icon
              key={p.href}
              title={p.title}
              face={p.face}
              onClick={() => open(portDrag(p))}
            />
          ))}
        </div>
      </div>

      {/* Every open window stays mounted, so nothing unsaved in one is
          lost while another is in front or home is; the one in front is
          the one shown, edge to edge. */}
      {windows.map((c) => (
        <div
          key={c.id}
          className={cx(
            "fixed inset-0 z-30 flex-col bg-background-full pt-[calc(env(safe-area-inset-top)+25px)]",
            view === "app" && front?.id === c.id ? "flex" : "hidden",
          )}
        >
          <App
            card={c}
            computers={computers}
            Panel={panels[pathOf(c.href)]}
            others={windows.filter((x) => x.id !== c.id)}
            onAnother={() => onAnother(c)}
            onClose={() => onClose(c.id)}
            onGo={go}
            onGuard={onGuard}
            fresh={born.has(c.id)}
            onArrived={() => born.delete(c.id)}
            reload={afresh[c.id] ?? 0}
          />
        </div>
      ))}

      {/* The recents: every open window as a card in a deck. */}
      <AnimatePresence>
        {view === "recents" && (
          <motion.div
            key="recents"
            initial={still ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FAST}
            className="fixed inset-0 z-40 flex flex-col justify-center bg-black/30 backdrop-blur-sm"
            onClick={() => setView("home")}
          >
            {windows.length === 0 ? (
              <p className="text-center text-body-regular text-text-white/80">
                Nothing open.
              </p>
            ) : (
              <div
                className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-[14vw] pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {windows
                  .slice()
                  .reverse()
                  .map((c) => (
                    <Recent
                      key={c.id}
                      card={c}
                      face={
                        BLOCKS.find((b) => pathOf(b.href) === pathOf(c.href))
                          ?.face
                      }
                      onGo={() => go(c)}
                      onClose={() => onClose(c.id)}
                    />
                  ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {view !== "home" && handle}
    </>
  );
}

// One icon on the home screen: its face and its name.
function Icon({
  title,
  face,
  onClick,
}: {
  title: string;
  face?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring rounded-2xl"
    >
      {face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={face}
          alt=""
          draggable={false}
          className="size-[60px] rounded-[18px] shadow-[0_2px_6px_rgb(0_0_0/0.35)]"
        />
      ) : (
        <span className="glass-pane grid size-[60px] place-items-center rounded-[18px]">
          <RiWindowLine className="size-7 text-text-primary" aria-hidden />
        </span>
      )}
      <span className="max-w-[76px] truncate text-caption-2-medium text-text-white drop-shadow">
        {title}
      </span>
    </button>
  );
}

// The app in front: its name in a bar, its own controls behind one
// button, and the surface itself filling the rest.
function App({
  card,
  computers,
  Panel,
  others,
  onAnother,
  onClose,
  onGo,
  onGuard,
  fresh,
  onArrived,
  reload,
}: {
  card: Card;
  computers: boolean;
  Panel: Panel | undefined;
  others: Card[];
  onAnother: () => void;
  onClose: () => void;
  onGo: (c: Card) => void;
  onGuard: (key: string, ask: (() => Promise<boolean>) | null) => void;
  fresh: boolean;
  // Said once the window is up, so its first opening is not asked again.
  onArrived: () => void;
  reload: number;
}) {
  useEffect(() => {
    onArrived();
  }, [onArrived]);
  const [sheet, setSheet] = useState(false);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const beforeClose = useCallback(
    (ask: (() => Promise<boolean>) | null) => onGuard(card.id, ask),
    [card.id, onGuard],
  );
  const act = (fn: () => void) => {
    setSheet(false);
    fn();
  };
  return (
    <>
      <header className="grid h-11 shrink-0 grid-cols-[44px_1fr_44px] items-center border-b border-separator-border">
        <span />
        <span className="truncate text-center text-body-medium text-text-primary">
          {card.title}
        </span>
        <button
          type="button"
          aria-label="More"
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
          className="grid size-11 place-items-center text-foreground-icon-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring rounded-2lg"
        >
          <RiMoreLine className="size-5" aria-hidden />
        </button>
      </header>
      {Panel && (
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:rounded-none [&>*]:border-0">
          <BarSlot
            value={{
              controls: slot,
              leading: null,
              strip,
              phone: true,
              beforeClose,
            }}
          >
            <Panel id={card.id} href={card.href} fresh={fresh} />
          </BarSlot>
        </div>
      ) : (
        <iframe
          key={reload}
          src={card.href}
          title={card.title}
          sandbox={
            card.kind === "port"
              ? "allow-scripts allow-forms allow-same-origin allow-popups"
              : undefined
          }
          className={cx(
            "min-h-0 flex-1",
            card.kind === "port" ? "bg-background-full" : "bg-transparent",
          )}
        />
      )}
      <PhoneSheet
        open={sheet}
        onClose={() => setSheet(false)}
        label={card.title}
        bodyRef={setSlot}
        controls
      >
        <div className="bg-separator-border my-1 h-px" />
        <SheetRow onClick={() => act(onAnother)}>
          Another {card.title.replace(/\s\d+$/, "")}
        </SheetRow>
        <SheetRow onClick={() => act(onClose)}>Close</SheetRow>
        {others.length > 0 && <div className="bg-separator-border my-1 h-px" />}
        {others.map((c) => (
          <SheetRow key={c.id} onClick={() => act(() => onGo(c))}>
            {c.title}
          </SheetRow>
        ))}
      </PhoneSheet>
    </>
  );
}

// One card of the recents: the app's face and the window's name, a tap
// to it, a flick up to close it.
function Recent({
  card,
  face,
  onGo,
  onClose,
}: {
  card: Card;
  face?: string;
  onGo: () => void;
  onClose: () => void;
}) {
  const still = useReducedMotion();
  return (
    <motion.div
      layout
      drag={still ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.6, bottom: 0 }}
      onDragEnd={(_e, info) => {
        if (info.offset.y < -120 || info.velocity.y < -600) onClose();
      }}
      exit={{ opacity: 0, y: -80 }}
      transition={FAST}
      className="glass-pane relative flex h-[62dvh] w-[72vw] shrink-0 snap-center flex-col items-center justify-center gap-3 rounded-3xl"
    >
      <button
        type="button"
        onClick={onGo}
        aria-label={`Open ${card.title}`}
        className="absolute inset-0 rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      />
      {face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face} alt="" className="size-16 rounded-[20px] shadow" />
      ) : (
        <RiWindowLine
          className="size-12 text-foreground-icon-secondary"
          aria-hidden
        />
      )}
      <span className="pointer-events-none text-body-medium text-text-primary">
        {card.title}
      </span>
      <button
        type="button"
        aria-label={`Close ${card.title}`}
        onClick={onClose}
        className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-background-primary-default/70 text-foreground-icon-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <RiCloseLine className="size-5" aria-hidden />
      </button>
    </motion.div>
  );
}
