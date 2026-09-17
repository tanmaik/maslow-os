"use client";

import { RiCloseLine, RiMoreLine, RiWindowLine } from "@remixicon/react";
import {
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "motion/react";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { APPS, pathOf } from "@/app/desktop/apps";
import { BarSlot } from "@/app/desktop/panel";
import { PhoneSheet } from "@/app/desktop/sheet";
import type { Card, Port } from "@/app/desktop/tiles";
import { Notification } from "@/components/base/notification/notification";
import { cx } from "@/utils/cx";

// How a screen moves: pushed in from the right and popped back out, on a
// spring that settles without a bounce; the home screen recedes behind
// it. A press dips what it lands on the moment it lands.
const PUSH = {
  type: "spring",
  stiffness: 420,
  damping: 40,
  mass: 0.9,
} as const;
const DIP = { type: "spring", stiffness: 600, damping: 30 } as const;
// How far from the left edge a swipe back may begin.
const EDGE = 28;

// The phone: an app of its own over the same panels the desktop frames,
// and nothing of the desktop's windows. Home is a screen of icons, the
// apps and every port beside them, with the widgets laid as tiles above;
// a tap opens one edge to edge, into the notch and down to the home bar,
// with nothing to drag and nothing to resize. One is open at a time:
// opening another puts it away, the close at the bar's left goes home
// with it closed, and the handle under the screen goes home with it kept.
// None of it lies where the phone's own gestures do.

type Panel = ComponentType<{ fresh?: boolean; id?: string; href?: string }>;

// What is open: enough of a window to frame it.
type Open = Pick<Card, "id" | "kind" | "title" | "href">;

export function Phone({
  widgets,
  ports,
  computers,
  panels,
  wanted,
}: {
  widgets: Card[];
  ports: Port[];
  computers: boolean;
  panels: Record<string, Panel>;
  // The path of an app the desk was asked to open as it was drawn.
  wanted: string | null;
}) {
  const still = useReducedMotion();
  const [open, setOpen] = useState<Open | null>(null);
  const [view, setView] = useState<"home" | "app">("home");
  // The open screen's place, from the right edge (the width) to home (0):
  // the spring drives it, and so does a finger swiping back from the left
  // edge. Home recedes as it comes.
  const x = useMotionValue(0);
  const width = () => (typeof window === "undefined" ? 400 : window.innerWidth);
  const homeScale = useTransform(x, [0, 400], [0.94, 1]);
  const homeDim = useTransform(x, [0, 400], [0.55, 1]);
  const drag = useDragControls();
  // Whether the open screen stands off to the right, out of sight and
  // out of the way, its panel kept alive behind.
  const [parked, setParked] = useState(true);
  useEffect(() => {
    if (view === "app") setParked(false);
  }, [view]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > width() * 0.35 || info.velocity.x > 500)
      setView("home");
  };
  // Whether what is open was opened this moment, and so starts something
  // new rather than joining what was there.
  const [fresh, setFresh] = useState(false);
  // What the open panel wants asked before it goes, if anything.
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const onGuard = useCallback(
    (ask: (() => Promise<boolean>) | null) => (guard.current = ask),
    [],
  );

  // What lies under the menu bar and the handle: the wallpaper at home,
  // a window's paper in an app. The document says which, so both read
  // on it.
  useEffect(() => {
    if (view === "app") document.documentElement.dataset.paper = "";
    else delete document.documentElement.dataset.paper;
    return () => {
      delete document.documentElement.dataset.paper;
    };
  }, [view]);

  const show = async (next: Open) => {
    if (open && open.href === next.href) return setView("app");
    if (open && guard.current && !(await guard.current())) return;
    guard.current = null;
    setOpen(next);
    setFresh(true);
    setView("app");
  };
  const close = async () => {
    if (guard.current && !(await guard.current())) return;
    guard.current = null;
    setOpen(null);
    setView("home");
  };
  // Asked for an app as the desk was drawn, it is opened as a tap would.
  useEffect(() => {
    if (!wanted) return;
    const app = APPS.find((b) => pathOf(b.href) === pathOf(wanted));
    if (app)
      void show({
        id: pathOf(app.href),
        kind: app.kind,
        title: app.title,
        href: wanted,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  return (
    <>
      {/* Home: the widgets as tiles, then every app and every port. It
          recedes and dims under an app as the app comes in. */}
      <motion.div
        aria-hidden={view !== "home"}
        style={
          still || !open ? undefined : { scale: homeScale, opacity: homeDim }
        }
        className={cx(
          "fixed inset-0 z-10 overflow-y-auto overscroll-y-contain px-5 pt-[calc(env(safe-area-inset-top)+25px+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+4rem)] select-none",
          view !== "home" && "pointer-events-none",
        )}
      >
        {widgets.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-4">
            {widgets.map((w) => (
              <motion.button
                key={w.id}
                type="button"
                whileTap={still ? undefined : { scale: 0.96 }}
                transition={DIP}
                onClick={() => void show(w)}
                className="glass-pane flex aspect-square flex-col justify-between rounded-3xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                <RiWindowLine
                  className="size-6 text-foreground-icon-secondary"
                  aria-hidden
                />
                <span className="text-body-medium text-text-primary">
                  {w.title}
                </span>
              </motion.button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-4 gap-x-3 gap-y-6">
          {APPS.map((b) => (
            <Icon
              key={b.href}
              title={b.title}
              face={b.face}
              open={open?.href === b.href}
              onClick={() =>
                void show({
                  id: pathOf(b.href),
                  kind: b.kind,
                  title: b.title,
                  href: b.href,
                })
              }
            />
          ))}
          {ports.map((p) => (
            <Icon
              key={p.href}
              title={p.title}
              face={p.face}
              open={open?.href === p.href}
              onClick={() =>
                void show({
                  id: p.href,
                  kind: "port",
                  title: p.title,
                  href: p.href,
                })
              }
            />
          ))}
        </div>
      </motion.div>

      {/* The open app, edge to edge, pushed in from the right and kept
          while home is shown so nothing in it is lost. A swipe from the
          left edge carries it back out under the finger. */}
      {open && (
        <motion.div
          drag={still ? false : "x"}
          dragControls={drag}
          dragListener={false}
          dragConstraints={{ left: 0 }}
          dragElastic={0}
          dragDirectionLock
          onDragEnd={onDragEnd}
          onPointerDown={(e) => {
            if (!still && e.clientX < EDGE) drag.start(e);
          }}
          style={{ x }}
          initial={still ? false : { x: "100%" }}
          animate={{ x: view === "app" ? 0 : "100%" }}
          transition={still ? { duration: 0 } : PUSH}
          onAnimationComplete={() => view !== "app" && setParked(true)}
          className={cx(
            "fixed inset-0 z-30 flex flex-col bg-background-full pt-[calc(env(safe-area-inset-top)+25px)] shadow-[-12px_0_32px_-8px_rgb(0_0_0/0.35)]",
            parked && view !== "app" && "invisible",
          )}
        >
          <App
            key={open.href}
            open={open}
            computers={computers}
            Panel={panels[pathOf(open.href)]}
            fresh={fresh}
            onArrived={() => setFresh(false)}
            onGuard={onGuard}
            onClose={() => void close()}
          />
        </motion.div>
      )}

      {/* The handle: a tap goes home, with the app kept behind. */}
      {view === "app" && (
        <button
          type="button"
          aria-label="Home"
          onClick={() => setView("home")}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+2px)] left-1/2 z-[60] grid h-9 w-40 -translate-x-1/2 cursor-pointer place-items-center touch-none outline-none"
        >
          <span
            aria-hidden
            className="phone-handle h-1.5 w-28 rounded-full bg-white/70 shadow-[0_1px_2px_rgb(0_0_0/0.4)]"
          />
        </button>
      )}
    </>
  );
}

// One icon on the home screen: its face and its name, and a dot beside
// the name of the one that is open.
function Icon({
  title,
  face,
  open,
  onClick,
}: {
  title: string;
  face?: string;
  open: boolean;
  onClick: () => void;
}) {
  const still = useReducedMotion();
  return (
    <motion.button
      type="button"
      whileTap={still ? undefined : { scale: 0.92 }}
      transition={DIP}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
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
      <span className="flex items-center gap-1 text-caption-2-medium text-text-white drop-shadow">
        <span className="max-w-[76px] truncate">{title}</span>
        {open && (
          <span
            aria-hidden
            className="size-1 shrink-0 rounded-full bg-white/80"
          />
        )}
      </span>
    </motion.button>
  );
}

// The app in front: a close at the left of its bar, its name, its own
// controls behind one button, and the surface itself filling the rest.
function App({
  open,
  computers,
  Panel,
  fresh,
  onArrived,
  onGuard,
  onClose,
}: {
  open: Open;
  computers: boolean;
  Panel?: Panel;
  fresh: boolean;
  onArrived: () => void;
  onGuard: (ask: (() => Promise<boolean>) | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    onArrived();
  }, [onArrived]);
  const [sheet, setSheet] = useState(false);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <header className="grid h-11 shrink-0 grid-cols-[44px_1fr_44px] items-center border-b border-separator-border">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-11 place-items-center rounded-2lg text-foreground-icon-secondary outline-none transition-transform duration-fast ease-plain select-none focus-visible:ring-2 focus-visible:ring-border-focus-ring active:scale-90"
        >
          <RiCloseLine className="size-5" aria-hidden />
        </button>
        <span className="truncate text-center text-body-medium text-text-primary">
          {open.title}
        </span>
        {Panel ? (
          <button
            type="button"
            aria-label="More"
            aria-expanded={sheet}
            onClick={() => setSheet(true)}
            className="grid size-11 place-items-center rounded-2lg text-foreground-icon-secondary outline-none transition-transform duration-fast ease-plain select-none focus-visible:ring-2 focus-visible:ring-border-focus-ring active:scale-90"
          >
            <RiMoreLine className="size-5" aria-hidden />
          </button>
        ) : (
          <span />
        )}
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
              beforeClose: onGuard,
            }}
          >
            <Panel id={open.id} href={open.href} fresh={fresh} />
          </BarSlot>
        </div>
      ) : (
        <iframe
          src={open.href}
          title={open.title}
          sandbox={
            open.kind === "port"
              ? "allow-scripts allow-forms allow-same-origin allow-popups"
              : undefined
          }
          className={cx(
            "min-h-0 flex-1",
            open.kind === "port" ? "bg-background-full" : "bg-transparent",
          )}
        />
      )}
      {Panel && (
        <PhoneSheet
          open={sheet}
          onClose={() => setSheet(false)}
          label={open.title}
          bodyRef={setSlot}
          controls
        />
      )}
    </>
  );
}
