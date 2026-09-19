"use client";

// The dock, ryOS's (github.com/ryokun6/ryos, AGPL-3.0) made ours: every
// block as its icon on a glass shelf along the bottom, the icons swelling
// under the pointer, a window minimized flying into it, and the shelf
// sliding out of sight when it is let hide. The look and the motion are
// theirs; what it holds and what a click does are the desktop's.

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { APPS, boxOf, faceOf } from "@/app/desktop/apps";
import type { Box, Card, Port } from "@/app/desktop/tiles";
import { StatusDot } from "@/components/base/badges/status-dot";
import { BASE, CALM, FAST, LEAVE, SNAP, SWELL } from "@/lib/motion";
import { cx as cn } from "@/utils/cx";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// What is carried while a block is dragged from the dock: what it frames
// and the size it opens at.
export const DRAG = "application/x-maslow-card";
export type Dragged = {
  kind: Card["kind"];
  title: string;
  href: string;
  box: Box;
};

// Which edge the dock lies along.
export type Side = "bottom" | "left" | "right";

// A window on some desktop, open or minimized.
export type Held = { screen: string; card: Card };

// An icon's size at rest, how much bigger it grows under the pointer, and
// how far from the pointer the swell reaches.
const ICON = 48;
export const DOCK_SIZE = "maslow.dock.size";
export const ICON_SMALLEST = 40;
export const ICON_LARGEST = 64;
const DOCK_MAGNIFY_DISTANCE = 140;
const PADDING = 4;
const EDGE_PADDING = 12;

// The shelf's thickness: an icon, its padding along the edge, and the
// half-pixel rim on either side, which takes room of its own.
const shelfOf = (iconSize: number) => iconSize + EDGE_PADDING * 2 + 1;

// How far the shelf sits from the edge of the screen, and the room the
// dock keeps under it along the bottom for a hand coming from the edge.
const EDGE_MARGIN = 6;
const EDGE_ROOM = 12;

// What the dock takes on its edge: the shelf, the gap beneath it, and
// along the bottom the room under that, so a filled window stops exactly
// where the shelf starts.
export const clearOf = (iconSize: number, side: Side = "bottom") =>
  shelfOf(iconSize) + EDGE_MARGIN + (side === "bottom" ? EDGE_ROOM : 0);

// How big the icons stand at rest, kept on this device beside the dock's
// other settings, and followed the moment it changes anywhere.
export function useDockIconSize() {
  const [size, setSize] = useState(ICON);
  useEffect(() => {
    const read = () => {
      const kept = Number(localStorage.getItem(DOCK_SIZE));
      setSize(
        Number.isFinite(kept) && kept >= ICON_SMALLEST && kept <= ICON_LARGEST
          ? kept
          : ICON,
      );
    };
    read();
    addEventListener("storage", read);
    return () => removeEventListener("storage", read);
  }, []);
  return size;
}

const AUTO_HIDE_DELAY_DESKTOP = 6000;
// On a phone the dock goes sooner, and a swipe up from the bottom brings
// it back (ryOS MacDock.tsx:171,307).
const AUTO_HIDE_DELAY_PHONE = 4000;
// A swipe up of at least this much, more up than sideways, from the zone
// along the bottom edge, reveals the dock; less than the second is a tap
// (ryOS dockRevealGesture.ts).
const DOCK_SWIPE_UP_THRESHOLD_PX = 48;
const DOCK_SWIPE_MOVE_THRESHOLD_PX = 12;
const revealsDock = (dx: number, dy: number) => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < DOCK_SWIPE_MOVE_THRESHOLD_PX && ay < DOCK_SWIPE_MOVE_THRESHOLD_PX)
    return false;
  return dy < -DOCK_SWIPE_UP_THRESHOLD_PX && ay > ax;
};
const AUTO_HIDE_COOLDOWN = 500;

// One icon's stretch along the shelf, and the width of a divider between
// two runs: what a place is measured in while an icon is carried.
const DIVIDER = 21;

// Where each run of the shelf begins: the apps, then the ports, then the
// windows minimized. A run is arranged inside its own stretch and never
// past the divider that ends it.
const PORTS = 100;
const MINIMIZED = 200;

// The order the person put the shelf in, as addresses, kept on this
// device beside the dock's other settings.
const ORDER = "maslow.dock.order";

// One run of icons in the order the person left it: what they arranged
// first, in that order, and anything they never touched in the place it
// has by right.
function arrange<T extends { href: string }>(list: T[], order: string[]): T[] {
  if (order.length === 0) return list;
  const known = order
    .map((href) => list.find((x) => x.href === href))
    .filter((x): x is T => x !== undefined);
  const out = known.slice();
  list.forEach((item, i) => {
    if (!known.includes(item)) out.splice(Math.min(i, out.length), 0, item);
  });
  return out;
}

// A list with one of its own moved to another place in it.
const moved = (list: string[], from: number, to: number): string[] => {
  const out = list.slice();
  const [one] = out.splice(from, 1);
  if (one !== undefined) out.splice(to, 0, one);
  return out;
};

// Which icon the hand is on, and whether it came straight from another,
// in which case the label swaps without its usual fade.
function useDockIconHover() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleIconHover = useCallback((id: string) => {
    const swapping = leaving.current !== null;
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = null;
    setHoveredId(id);
    setIsSwapping(swapping);
  }, []);

  const handleIconLeave = useCallback(() => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = setTimeout(() => {
      setHoveredId(null);
      setIsSwapping(false);
      leaving.current = null;
    }, 50);
  }, []);

  return { hoveredId, isSwapping, handleIconHover, handleIconLeave };
}

// Where the pointer is along the dock, for the icons to swell towards;
// never on a touch screen, and only while the person wants it.
function useDockMagnification(dockMagnification: boolean) {
  const mouseX = useMotionValue<number>(Infinity);
  const [magnifyEnabled, setMagnifyEnabled] = useState(true);
  const still = useReducedMotion();

  useEffect(() => {
    const mqlPointerCoarse = window.matchMedia("(pointer: coarse)");
    const mqlHoverNone = window.matchMedia("(hover: none)");
    const compute = () =>
      setMagnifyEnabled(!(mqlPointerCoarse.matches || mqlHoverNone.matches));
    compute();
    mqlPointerCoarse.addEventListener("change", compute);
    mqlHoverNone.addEventListener("change", compute);
    return () => {
      mqlPointerCoarse.removeEventListener("change", compute);
      mqlHoverNone.removeEventListener("change", compute);
    };
  }, []);

  return {
    mouseX,
    effectiveMagnifyEnabled: magnifyEnabled && dockMagnification && !still,
  };
}

const DockIconButton = memo(function DockIconButton({
  label,
  onClick,
  icon,
  idKey,
  showIndicator = false,
  mouseX,
  magnifyEnabled,
  isHovered,
  isSwapping,
  onHover,
  onLeave,
  draggable = false,
  onDragStart,
  onDragEnd,
  badge,
  menu,
  onMenuOpen,
  side,
  minimized = false,
  place,
  carried = false,
  iconSize,
}: {
  label: string;
  onClick: () => void;
  icon: string;
  idKey: string;
  // How big it stands at rest, as the person set it under Look.
  iconSize: number;
  side: Side;
  // Where along the shelf it is drawn. Where it is drawn is the shelf's
  // to say and never where it stands in the page, so an icon being
  // carried is never moved under the hand, which would end the carrying.
  place: number;
  // Whether the icon stands for a window minimized rather than an app.
  minimized?: boolean;
  // Whether the hand is carrying it: its place stays, drawn empty.
  carried?: boolean;
  showIndicator?: boolean;
  mouseX: MotionValue<number>;
  magnifyEnabled: boolean;
  isHovered: boolean;
  isSwapping: boolean;
  onHover: () => void;
  onLeave: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  // Drawn over the icon's corner: a count.
  badge?: ReactNode;
  // What a right-click or a long press offers.
  menu: ReactNode;
  onMenuOpen: (open: boolean) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const isPresent = useIsPresent();

  const targetSize = useMotionValue(iconSize);

  // Back to rest whenever the rest size changes — a size set under Look, or
  // the swell being turned off. The pointer's next move inflates it again.
  useEffect(() => {
    targetSize.set(iconSize);
  }, [magnifyEnabled, targetSize, iconSize]);

  const vertical = side !== "bottom";
  // Where this icon sits when nothing is swollen. Size feeds layout and
  // layout would feed size, so the distance is measured against the rest
  // place, read while the hand is away, and never against the live box.
  const rest = useRef<number | null>(null);
  useEffect(() => {
    const read = () => {
      const b = wrapperRef.current?.getBoundingClientRect();
      if (b)
        rest.current = vertical ? b.top + b.height / 2 : b.left + b.width / 2;
    };
    // The moment the hand arrives, while everything is still at rest, and
    // again a beat after it leaves, once the springs have settled.
    let soon: ReturnType<typeof setTimeout> | undefined;
    let away = true;
    const when = (val: number) => {
      clearTimeout(soon);
      const off = !Number.isFinite(val);
      if (!off && away) read();
      away = off;
      if (off) soon = setTimeout(read, 400);
    };
    when(mouseX.get());
    const stop = mouseX.on("change", when);
    window.addEventListener("resize", read);
    return () => {
      clearTimeout(soon);
      stop();
      window.removeEventListener("resize", read);
    };
  }, [mouseX, vertical]);
  const distanceCalc = useTransform(mouseX, (val) => {
    const centre = rest.current;
    if (centre === null || !Number.isFinite(val)) return Infinity;
    return val - centre;
  });

  useEffect(() => {
    if (!magnifyEnabled) return;

    const unsubscribe = distanceCalc.on("change", (dist) => {
      const absDist = Math.abs(dist);
      if (!Number.isFinite(dist) || absDist > DOCK_MAGNIFY_DISTANCE) {
        targetSize.set(iconSize);
      } else {
        const t = 1 - absDist / DOCK_MAGNIFY_DISTANCE;
        targetSize.set(iconSize + t * (iconSize * 1.3));
      }
    });

    return unsubscribe;
  }, [magnifyEnabled, distanceCalc, targetSize, iconSize]);

  const sizeSpring = useSpring(targetSize, SWELL);
  const widthValue = isPresent ? sizeSpring : 0;

  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      tabIndex={-1}
      // The icon is drawn at the size the person set; what a thumb has to
      // hit reaches 2px past it on every side, into the gap between
      // icons, so the smallest icon is still a 44px target.
      className="relative flex size-full items-end justify-center rounded-2lg outline-none transition-[filter] duration-instant ease-plain after:absolute after:-inset-[2px] after:content-[''] active:brightness-[0.92] focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    >
      <div className="flex size-full items-end justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={icon}
          alt=""
          width={iconSize}
          height={iconSize}
          draggable={false}
          className={cn(
            "pointer-events-none size-full select-none",
            // A window minimized is a picture of that window, not the app
            // beside it: smaller, under a hairline.
            minimized && "scale-90 rounded-[22%] ring-1 ring-white/30",
          )}
          style={{ imageRendering: "-webkit-optimize-contrast" }}
        />
      </div>
      {badge}
      <AnimatePresence>
        {showIndicator && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={FAST}
            className="absolute"
            style={
              // The dot sits on the edge facing off the screen, as it does
              // under a shelf along the bottom.
              side === "bottom"
                ? { bottom: -9 }
                : {
                    [side]: -9,
                    top: "50%",
                    marginTop: -6,
                  }
            }
          >
            <StatusDot color="green" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );

  return (
    <motion.div
      ref={wrapperRef}
      layout
      layoutId={`dock-icon-${idKey}`}
      data-dock-icon={idKey}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: carried ? 0 : 1 }}
      exit={{ scale: 0.6, opacity: 0 }}
      transition={{ ...SNAP, layout: BASE }}
      style={{
        order: place,
        transformOrigin: side === "bottom" ? "bottom center" : `${side} center`,
        willChange: "width, height, transform",
        width: widthValue,
        height: widthValue,
        // The gap between icons lies along the shelf, whichever way it
        // runs: across on a shelf at the bottom, down on one at a side.
        marginLeft: isPresent && !vertical ? 4 : 0,
        marginRight: isPresent && !vertical ? 4 : 0,
        marginTop: isPresent && vertical ? 4 : 0,
        marginBottom: isPresent && vertical ? 4 : 0,
        cursor: draggable ? "grab" : "pointer",
      }}
      className="relative shrink-0"
    >
      <AnimatePresence>
        {isHovered && (
          <motion.div
            // BoardUI's tooltip: it condenses into place, blurred and a
            // little small, and leaves the same way, faster.
            initial={{
              opacity: 0,
              scale: 0.9,
              filter: "blur(4px)",
              ...(vertical ? { y: "-50%" } : { x: "-50%" }),
            }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
              ...(vertical ? { y: "-50%" } : { x: "-50%" }),
              transition: isSwapping ? { duration: 0 } : BASE,
            }}
            exit={{
              opacity: 0,
              scale: 0.9,
              filter: "blur(4px)",
              ...(vertical ? { y: "-50%" } : { x: "-50%" }),
              transition: isSwapping ? { duration: 0 } : LEAVE,
            }}
            className={cn(
              "glass-solid text-caption-1-medium text-text-primary pointer-events-none absolute z-50 max-w-[240px] rounded-lg px-2.5 py-1.5 whitespace-nowrap select-none",
              side === "bottom" && "left-1/2",
              vertical && "top-1/2",
            )}
            // Held a fixed distance off the shelf, not off the icon: an
            // icon grows under the hand and the label must not ride up
            // with it.
            style={{
              [side === "bottom"
                ? "bottom"
                : side === "left"
                  ? "left"
                  : "right"]: iconSize + 12,
            }}
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
      <ContextMenu onOpenChange={onMenuOpen}>
        <ContextMenuTrigger className="block size-full">
          {button}
        </ContextMenuTrigger>
        <ContextMenuContent>{menu}</ContextMenuContent>
      </ContextMenu>
    </motion.div>
  );
});

// The hairline between one run of icons and the next.
function DockDivider({
  idKey,
  height,
  vertical,
  place,
}: {
  idKey: string;
  height: number;
  vertical: boolean;
  place: number;
}) {
  return (
    <motion.div
      layout
      layoutId={`dock-divider-${idKey}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.9 }}
      exit={{ opacity: 0 }}
      transition={CALM}
      className="relative z-[5] flex shrink-0 items-center justify-center self-center"
      style={{
        order: place,
        ...(vertical
          ? { width: height, padding: "10px 0" }
          : { height, padding: "0 10px" }),
      }}
    >
      <div
        className="bg-dock-line size-full"
        style={
          vertical
            ? { height: 1, borderRadius: 2 }
            : { width: 1, borderRadius: 2 }
        }
      />
    </motion.div>
  );
}

export function Dock({
  phone,
  hiding,
  magnify,
  side,
  ports,
  held,
  onHiding,
  onMagnify,
  onSide,
  onBegin,
  onEnd,
  onPick,
  onPin,
  onFront,
  onClose,
}: {
  // On a phone: along the bottom, scrolling sideways when it overflows,
  // hiding on its own and back on a swipe up.
  phone: boolean;
  // Whether the dock hides when the hand leaves it, and whether its
  // icons swell under the pointer; a right-click on the shelf turns
  // either.
  hiding: boolean;
  magnify: boolean;
  // The edge it lies along.
  side: Side;
  onHiding: (to: boolean) => void;
  onMagnify: (to: boolean) => void;
  onSide: (to: Side) => void;
  ports: Port[];
  // Every window on every desktop, open or minimized.
  held: Held[];
  onBegin: (item: Dragged) => (e: DragEvent) => void;
  onEnd: () => void;
  onPick: (b: Dragged) => void;
  // A port put on the desktop as a widget.
  onPin: (b: Dragged) => void;
  // A window brought to the front, back from the dock if it was minimized.
  onFront: (w: Held) => void;
  onClose: (w: Held) => void;
}) {
  const vertical = side !== "bottom";
  const iconSize = useDockIconSize();
  // The shelf's thickness and one icon's stretch along it, both measured
  // from the size the person set.
  const SHELF = shelfOf(iconSize);
  const PITCH = iconSize + PADDING * 2;
  const { hoveredId, isSwapping, handleIconHover, handleIconLeave } =
    useDockIconHover();

  const { mouseX, effectiveMagnifyEnabled } = useDockMagnification(magnify);

  // Whether a menu is open on the dock, which keeps it from hiding
  // meanwhile.
  const [busy, setBusy] = useState(false);

  // Whether the dock is out, and what keeps it out: the hand over it, or a
  // timer since it was last shown.
  const [isDockVisible, setIsDockVisible] = useState(!hiding || phone);
  // How far the keyboard has come up on a phone, so the shelf and its grip
  // stand above it rather than behind it.
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!phone) return setLift(0);
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => {
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      setLift(hidden > 80 ? hidden : 0);
    };
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    measure();
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, [phone]);
  const isMouseInZoneRef = useRef(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoHideTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!hiding) {
      setIsDockVisible(true);
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    } else if (!isMouseInZoneRef.current && !phone) {
      setIsDockVisible(false);
    }
  }, [hiding]);

  useEffect(
    () => () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    },
    [],
  );

  const restartAutoHideTimer = useCallback(() => {
    if (!hiding) return;
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    if (busy) return;
    autoHideTimerRef.current = setTimeout(
      () => {
        if (!isMouseInZoneRef.current) {
          setIsDockVisible(false);
          autoHideTimerRef.current = null;
          lastAutoHideTimeRef.current = Date.now();
        } else {
          autoHideTimerRef.current = null;
          restartAutoHideTimer();
        }
      },
      phone ? AUTO_HIDE_DELAY_PHONE : AUTO_HIDE_DELAY_DESKTOP,
    );
  }, [hiding, busy, phone]);

  useEffect(() => {
    if (hiding && isDockVisible && !busy) restartAutoHideTimer();
  }, [hiding, isDockVisible, busy, restartAutoHideTimer]);

  const showDock = useCallback(() => {
    if (hiding) {
      const timeSinceAutoHide = Date.now() - lastAutoHideTimeRef.current;
      if (timeSinceAutoHide < AUTO_HIDE_COOLDOWN) return;
    }
    isMouseInZoneRef.current = true;
    setIsDockVisible(true);
    restartAutoHideTimer();
  }, [hiding, restartAutoHideTimer]);

  const hideDock = useCallback(() => {
    isMouseInZoneRef.current = false;
    if (!hiding || busy) return;
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    setIsDockVisible(false);
  }, [hiding, busy]);

  // On a phone a hidden dock comes back on a swipe up that starts in the
  // zone along the bottom edge, the dock's height plus the safe area, and
  // goes up by 48 or more, more up than sideways (ryOS MacDock.tsx:369-430,
  // dockRevealGesture.ts).
  useEffect(() => {
    if (!phone || !hiding || isDockVisible) return;
    // Touch events rather than pointer events: the browser takes a touch
    // that pans as its own and cancels the pointer at once, while the
    // touch's own end still says where the finger lifted.
    let held: { id: number; x: number; y: number } | null = null;
    const zone = () => {
      const safe = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--safe-area-bottom",
        ),
        10,
      );
      return SHELF + (Number.isFinite(safe) ? safe : 0);
    };
    const start = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const vv = window.visualViewport;
      const floor = vv ? vv.height + vv.offsetTop : window.innerHeight;
      if (!t || t.clientY < floor - zone()) return;
      held = { id: t.identifier, x: t.clientX, y: t.clientY };
    };
    const end = (e: TouchEvent) => {
      if (!held) return;
      const t = [...e.changedTouches].find((x) => x.identifier === held!.id);
      if (!t) return;
      const dx = t.clientX - held.x;
      const dy = t.clientY - held.y;
      held = null;
      // A swipe up, or a plain tap in the zone: the swipe from the very
      // edge is the phone's own home gesture and rarely reaches the page.
      const tap =
        Math.abs(dx) < DOCK_SWIPE_MOVE_THRESHOLD_PX &&
        Math.abs(dy) < DOCK_SWIPE_MOVE_THRESHOLD_PX;
      if (e.type === "touchend" && (revealsDock(dx, dy) || tap)) {
        setIsDockVisible(true);
        restartAutoHideTimer();
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [phone, hiding, isDockVisible, restartAutoHideTimer, SHELF]);

  const minimized = held.filter((w) => w.card.minimized);

  // The shelf in the order the person put it in: the apps among the apps
  // and the ports among the ports, neither crossing the divider between
  // them.
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    try {
      const kept: unknown = JSON.parse(localStorage.getItem(ORDER) ?? "[]");
      if (Array.isArray(kept))
        setOrder(kept.filter((h): h is string => typeof h === "string"));
    } catch {
      // An order that cannot be read is an order nobody set.
    }
  }, []);
  const apps = arrange(APPS, order);
  const shown = arrange(ports, order);
  const live = useRef(order);
  live.current = order;
  // An icon put in another place, and the whole shelf's order with it.
  // This is the one place the order is worked out; kept on this device
  // the moment the person is done moving it.
  const rearrange = (port: boolean, from: number, to: number, keep = false) => {
    if (from === to || from < 0) return;
    const mine = (port ? shown : apps).map((x) => x.href);
    const rest = (port ? apps : shown).map((x) => x.href);
    const next = moved(mine, from, to);
    const all = port ? [...rest, ...next] : [...next, ...rest];
    live.current = all;
    setOrder(all);
    if (keep) localStorage.setItem(ORDER, JSON.stringify(all));
  };
  const remember = () =>
    localStorage.setItem(ORDER, JSON.stringify(live.current));

  // The keys reach the dock as one stop: Tab lands on one icon, the
  // arrows walk the rest, Return opens, Shift and F10 opens the menu.
  const shelf = useRef<HTMLDivElement>(null);
  // A menu opened over the shelf takes the pointer with it, so the shelf
  // never hears it leave: when the menu closes and the hand is elsewhere,
  // the icons go back to their size themselves.
  const menus = (open: boolean) => {
    setBusy(open);
    if (open) return;
    requestAnimationFrame(() => {
      if (shelf.current?.matches(":hover")) return;
      mouseX.set(Infinity);
      handleIconLeave();
    });
  };
  // Every icon in the order the eye reads them, which is the shelf's
  // order and not the page's.
  const icons = () =>
    Array.from(
      shelf.current?.querySelectorAll<HTMLButtonElement>(
        "[data-dock-icon] button[aria-label]",
      ) ?? [],
    ).sort((a, c) => {
      const one = a.getBoundingClientRect();
      const two = c.getBoundingClientRect();
      return vertical ? one.top - two.top : one.left - two.left;
    });

  // An icon being carried: which one, and the order the shelf had before
  // it was picked up. Carried along the shelf it changes places with its
  // neighbours; carried off the shelf it opens a window where it lands
  // and the shelf goes back to the order it was in. Which of the two it
  // is, is simply whether the hand is still over the shelf.
  const carrying = useRef<{
    href: string;
    port: boolean;
    was: string[];
  } | null>(null);
  // The icon being carried leaves its place empty on the shelf: what the
  // eye follows is the one under the hand.
  const [carried, setCarried] = useState<string | null>(null);
  // When the hand was last seen over the shelf, so letting go tells the
  // two gestures apart: still over it, the shelf keeps the new order.
  const over = useRef(0);
  const lifted = (href: string, port: boolean) => {
    carrying.current = { href, port, was: live.current };
    over.current = 0;
    setCarried(href);
    // Nothing swells while an icon is being carried: the places have to
    // hold still to be counted.
    mouseX.set(Infinity);
    handleIconLeave();
  };
  const alongTheShelf = (x: number, y: number) => {
    over.current = Date.now();
    const held = carrying.current;
    const box = shelf.current?.getBoundingClientRect();
    if (!held || !box) return;
    const group = held.port ? shown : apps;
    const from = group.findIndex((g) => g.href === held.href);
    if (from < 0) return;
    // Which place the hand is over, counted in the shelf's own rest
    // measure and never in the icons' live boxes, which are sliding.
    const start =
      (vertical ? box.top : box.left) +
      PADDING +
      (held.port ? apps.length * PITCH + DIVIDER : 0);
    const over_ = Math.floor(((vertical ? y : x) - start) / PITCH);
    const to = Math.max(0, Math.min(group.length - 1, over_));
    rearrange(held.port, from, to);
  };
  const letGo = () => {
    const held = carrying.current;
    carrying.current = null;
    setCarried(null);
    if (!held) return;
    // Off the shelf: the gesture was opening a window, so the shelf goes
    // back to the order it had.
    if (Date.now() - over.current < 400) remember();
    else setOrder(held.was);
  };
  useEffect(() => {
    const all = icons();
    if (!all.some((b) => b.tabIndex === 0))
      all[0]?.setAttribute("tabindex", "0");
  });
  const onShelfKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = icons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const ahead = vertical ? "ArrowDown" : "ArrowRight";
    const behind = vertical ? "ArrowUp" : "ArrowLeft";
    // Held with Option, an arrow moves the icon itself one place along
    // the shelf rather than moving to the next one.
    if (e.altKey && (e.key === ahead || e.key === behind)) {
      const one = all[at]!.closest<HTMLElement>("[data-dock-icon]");
      const href = one?.dataset.dockIcon;
      if (!href) return;
      const port = !APPS.some((b) => b.href === href);
      const group = port ? shown : apps;
      const from = group.findIndex((g) => g.href === href);
      const step = e.key === ahead ? 1 : -1;
      const to = from + step;
      if (from < 0 || to < 0 || to >= group.length) return;
      e.preventDefault();
      rearrange(port, from, to, true);
      // The icon keeps the keys: moving an element in the page takes the
      // focus off it.
      const keep = all[at]!;
      requestAnimationFrame(() => keep.focus());
      return;
    }
    let to = -1;
    if (e.key === ahead) to = (at + 1) % all.length;
    else if (e.key === behind) to = (at - 1 + all.length) % all.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = all.length - 1;
    else if (e.key === "F10" && e.shiftKey) {
      e.preventDefault();
      const r = all[at]!.getBoundingClientRect();
      all[at]!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
      return;
    } else return;
    e.preventDefault();
    all.forEach((b, i) => b.setAttribute("tabindex", i === to ? "0" : "-1"));
    all[to]?.focus();
  };

  // The dock's own settings, on the shelf's menu and after every icon's.
  const settings = (
    <>
      <ContextMenuCheckboxItem checked={hiding} onCheckedChange={onHiding}>
        Dock hiding
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem checked={magnify} onCheckedChange={onMagnify}>
        Magnification
      </ContextMenuCheckboxItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Position</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={side}
            onValueChange={(v) => onSide(v as Side)}
          >
            <ContextMenuRadioItem value="left">Left</ContextMenuRadioItem>
            <ContextMenuRadioItem value="bottom">Bottom</ContextMenuRadioItem>
            <ContextMenuRadioItem value="right">Right</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
  // The icon a window wears: a port's is whatever serves there.
  const face = (c: Card) =>
    ports.find((p) => p.href === c.href)?.face ?? faceOf(c);

  // One block or one port as an icon: a click brings its window forward,
  // back from the dock if it was minimized, or opens the first; a drag
  // opens one where it is dropped; a right-click lists its windows and
  // opens another.
  const icon = (b: Dragged & { face: string }, place: number) => {
    const { face: src, ...item } = b;
    const mine = held.filter((w) => w.card.href === b.href);
    const last = mine.at(-1);
    return (
      <DockIconButton
        iconSize={iconSize}
        key={b.href}
        idKey={b.href}
        place={place}
        carried={carried === b.href}
        label={b.title}
        icon={src}
        onClick={() => (last ? onFront(last) : onPick(item))}
        showIndicator={mine.length > 0}
        mouseX={mouseX}
        magnifyEnabled={effectiveMagnifyEnabled}
        isHovered={hoveredId === b.href}
        isSwapping={isSwapping}
        onHover={() => handleIconHover(b.href)}
        onLeave={handleIconLeave}
        draggable
        onDragStart={(e) => {
          lifted(b.href, b.kind === "port");
          onBegin(item)(e);
        }}
        onDragEnd={() => {
          letGo();
          onEnd();
        }}
        onMenuOpen={menus}
        side={side}
        menu={
          <>
            <ContextMenuItem onClick={() => onPick(item)}>
              New window
            </ContextMenuItem>
            {b.kind === "port" && (
              <ContextMenuItem onClick={() => onPin(item)}>
                Put on the desktop
              </ContextMenuItem>
            )}
            {mine.length > 0 && (
              <>
                <ContextMenuSeparator />
                {mine.map((w) => (
                  <ContextMenuItem key={w.card.id} onClick={() => onFront(w)}>
                    {w.card.minimized
                      ? `${w.card.title} (minimized)`
                      : w.card.title}
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => mine.forEach(onClose)}
                >
                  {mine.length > 1 ? "Close them all" : "Close"}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            {settings}
          </>
        }
      />
    );
  };

  return (
    <>
      <div
        className={cn(
          "fixed z-50",
          side === "bottom" && "right-0 bottom-0 left-0",
          side === "left" && "inset-y-0 left-0",
          side === "right" && "inset-y-0 right-0",
        )}
        style={{ pointerEvents: "none" }}
      >
        <div
          className={cn(
            "flex",
            side === "bottom" && "w-full items-end justify-center",
            vertical && "h-full flex-col justify-center",
            side === "left" && "items-start",
            side === "right" && "items-end",
          )}
          style={
            vertical
              ? {
                  paddingTop: "calc(25px + env(safe-area-inset-top, 0px))",
                  paddingLeft: "env(safe-area-inset-left, 0px)",
                  paddingRight: "env(safe-area-inset-right, 0px)",
                }
              : {
                  paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${EDGE_ROOM + lift}px)`,
                }
          }
        >
          {/* The shelf's own menu; an icon's menu, further in, takes the
            right-click first. */}
          <ContextMenu onOpenChange={menus}>
            <ContextMenuTrigger className="contents">
              <motion.div
                ref={shelf}
                role="toolbar"
                aria-label="Dock"
                onKeyDown={onShelfKey}
                layout
                layoutRoot
                data-side={side}
                className={cn(
                  "mac-dock-surface glass inline-flex",
                  side === "bottom" && "items-end",
                  side === "left" && "flex-col items-start",
                  side === "right" && "flex-col items-end",
                )}
                initial={false}
                animate={{
                  x:
                    !vertical || isDockVisible
                      ? 0
                      : (side === "left" ? -1 : 1) * (SHELF + 10),
                  y: vertical || isDockVisible ? 0 : SHELF + 10,
                  opacity: isDockVisible ? 1 : 0,
                }}
                style={{
                  pointerEvents: isDockVisible ? "auto" : "none",
                  margin:
                    side === "bottom"
                      ? `0 0 ${EDGE_MARGIN}px`
                      : side === "left"
                        ? `0 0 0 ${EDGE_MARGIN}px`
                        : `0 ${EDGE_MARGIN}px 0 0`,
                  ...(vertical
                    ? {
                        width: SHELF,
                        padding: `${PADDING}px ${EDGE_PADDING}px`,
                        maxHeight: "min(92vh, 980px)",
                        transformOrigin: `${side} center`,
                      }
                    : {
                        height: SHELF,
                        padding: `${EDGE_PADDING}px ${PADDING}px`,
                        maxWidth: "min(92vw, 980px)",
                        transformOrigin: "center bottom",
                        // The dock scrolls sideways on a phone when its
                        // icons overflow (ryOS MacDock.tsx:799-802).
                        ...(phone && {
                          overflowX: "auto",
                          overscrollBehaviorX: "contain",
                          WebkitOverflowScrolling: "touch",
                          scrollbarWidth: "none",
                        }),
                      }),
                }}
                transition={{
                  // Going is one step shorter than coming back, and eases
                  // in; coming back decelerates.
                  x: isDockVisible ? BASE : LEAVE,
                  y: isDockVisible ? BASE : LEAVE,
                  opacity: FAST,
                  layout: SNAP,
                }}
                onDragOver={(e) => {
                  if (!carrying.current) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  alongTheShelf(e.clientX, e.clientY);
                }}
                onDrop={(e) => {
                  if (carrying.current) e.preventDefault();
                }}
                onMouseEnter={() => {
                  if (hiding) showDock();
                }}
                onMouseLeave={() => {
                  if (hiding) hideDock();
                  if (effectiveMagnifyEnabled && !busy) {
                    mouseX.set(Infinity);
                    handleIconLeave();
                  }
                }}
                onMouseMove={(e) => {
                  if (effectiveMagnifyEnabled && !busy)
                    mouseX.set(vertical ? e.clientY : e.clientX);
                }}
                onTouchStart={() => {
                  if (hiding) restartAutoHideTimer();
                }}
              >
                <LayoutGroup>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {APPS.map(({ mark: _mark, bounds: _bounds, ...b }) =>
                      icon(
                        b,
                        apps.findIndex((one) => one.href === b.href),
                      ),
                    )}

                    {shown.length > 0 && (
                      <DockDivider
                        key="divider-ports"
                        idKey="ports"
                        place={PORTS}
                        height={iconSize}
                        vertical={vertical}
                      />
                    )}

                    {ports.map((p) =>
                      icon(
                        {
                          kind: "port",
                          title: p.title,
                          href: p.href,
                          face:
                            p.face ?? faceOf({ kind: "port", href: p.href }),
                          box: boxOf({ kind: "port", href: p.href }),
                        },
                        PORTS + 1 + shown.findIndex((x) => x.href === p.href),
                      ),
                    )}

                    {minimized.length > 0 && (
                      <DockDivider
                        key="divider-minimized"
                        idKey="minimized"
                        place={MINIMIZED}
                        height={iconSize}
                        vertical={vertical}
                      />
                    )}

                    {minimized.map((w, i) => (
                      <DockIconButton
                        iconSize={iconSize}
                        key={w.card.id}
                        idKey={w.card.id}
                        place={MINIMIZED + 1 + i}
                        label={`Restore ${w.card.title}`}
                        icon={face(w.card)}
                        minimized
                        onClick={() => onFront(w)}
                        badge={
                          // Which window of its app this is — a name, not
                          // a count, so it is not drawn as one.
                          /\s\d+$/.test(w.card.title) ? (
                            <span
                              aria-hidden
                              className="text-caption-1-medium text-text-white absolute -top-0.5 -right-0.5 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]"
                            >
                              {w.card.title.split(" ").at(-1)}
                            </span>
                          ) : undefined
                        }
                        mouseX={mouseX}
                        magnifyEnabled={effectiveMagnifyEnabled}
                        isHovered={hoveredId === w.card.id}
                        isSwapping={isSwapping}
                        onHover={() => handleIconHover(w.card.id)}
                        onLeave={handleIconLeave}
                        onMenuOpen={menus}
                        side={side}
                        menu={
                          <>
                            <ContextMenuItem onClick={() => onFront(w)}>
                              Restore
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => onClose(w)}
                            >
                              Close
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            {settings}
                          </>
                        }
                      />
                    ))}
                  </AnimatePresence>
                </LayoutGroup>
              </motion.div>
            </ContextMenuTrigger>
            <ContextMenuContent>{settings}</ContextMenuContent>
          </ContextMenu>
        </div>

        {/* The edge a hidden dock lies behind: a pointer there brings it
            back. Under a finger, a phone held either way, it is a grip
            drawn over whatever fills the screen, since a finger cannot
            hover and the bottom edge is the phone's own: a tap on it
            brings the dock back. */}
        {hiding && !isDockVisible && phone && (
          <button
            type="button"
            aria-label="Show the dock"
            // A tap is meant, whatever the moment: none of the cooldown a
            // pointer straying over the edge gets.
            onClick={() => {
              setIsDockVisible(true);
              restartAutoHideTimer();
            }}
            className="fixed left-1/2 z-[70] flex h-6 w-16 -translate-x-1/2 cursor-pointer items-center justify-center"
            style={{
              pointerEvents: "auto",
              bottom: `calc(env(safe-area-inset-bottom) + ${6 + lift}px)`,
            }}
          >
            <span className="h-1.5 w-11 rounded-full bg-white/50 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
          </button>
        )}
        {hiding && !isDockVisible && !phone && (
          <div
            className={cn(
              "fixed z-40",
              side === "bottom" && "right-0 bottom-0 left-0",
              side === "left" && "inset-y-0 left-0",
              side === "right" && "inset-y-0 right-0",
            )}
            style={{
              [vertical ? "width" : "height"]: SHELF / 2,
              pointerEvents: "auto",
            }}
            onMouseEnter={showDock}
          />
        )}
      </div>
    </>
  );
}
