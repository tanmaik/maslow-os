"use client";

// The parts of a window that are ryOS's (github.com/ryokun6/ryos,
// AGPL-3.0), made ours: the three lights in its bar, the way it leaves for
// the dock, and the glow where a carried window would land.

import { RiAddLine, RiCloseLine, RiSubtractLine } from "@remixicon/react";
import {
  AnimatePresence,
  motion,
  type TargetAndTransition,
} from "motion/react";
import { createPortal } from "react-dom";

import type { Mark } from "@/app/desktop/apps";
import { FAST, FLIGHT, LEAVE } from "@/lib/motion";

type TrafficLightColor = "red" | "yellow" | "green";

const symbolIcons: Record<TrafficLightColor, Mark> = {
  red: RiCloseLine,
  yellow: RiSubtractLine,
  green: RiAddLine,
};

const colors: Record<TrafficLightColor, { fill: string; sign: string }> = {
  red: { fill: "#ff5f57", sign: "rgba(77, 0, 0, 0.85)" },
  yellow: { fill: "#febc2e", sign: "rgba(102, 60, 0, 0.85)" },
  green: { fill: "#28c840", sign: "rgba(0, 66, 0, 0.85)" },
};

// One of a window's three lights: close, minimized, fill the screen. A
// plain dot, grey on a window that is not in front; its sign shows once
// a hand is over the three of them.
export function TrafficLightButton({
  color,
  onClick,
  isForeground,
  ariaLabel,
}: {
  color: TrafficLightColor;
  onClick: () => void;
  isForeground: boolean;
  ariaLabel: string;
}) {
  const Icon = symbolIcons[color];
  return (
    <div className="group/light relative size-[12px]">
      <div
        aria-hidden="true"
        className="flex size-[12px] items-center justify-center rounded-full transition-[filter] duration-instant ease-plain group-active/light:brightness-90"
        style={{
          background: isForeground
            ? colors[color].fill
            : "var(--color-foreground-icon-quaternary)",
          // A dot this small is read by its edge, so the rim is what
          // carries the 3:1 a control needs, in either look.
          boxShadow: `inset 0 0 0 1px ${
            isForeground
              ? `color-mix(in srgb, ${colors[color].fill} 60%, black)`
              : "var(--color-foreground-icon-tertiary)"
          }`,
          color: colors[color].sign,
        }}
      >
        {isForeground && (
          <Icon className="size-[8px] opacity-0 transition-opacity duration-instant ease-plain group-hover/traffic:opacity-100" />
        )}
      </div>
      <button
        type="button"
        aria-label={ariaLabel}
        className="absolute -inset-x-[4px] -inset-y-[8px] z-10 cursor-default rounded-full opacity-0 outline-none max-sm:-inset-y-[16px] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// How a window leaves: minimized, it shrinks into its mark in the dock;
// taken down, it fades where it stands. The mark is measured only as the
// window goes, since it moves as the dock makes room and may not exist
// when the window is first drawn. Under reduced motion it fades where it
// stands either way: the meaning survives, the flight does not.
export function getExitAnimation(
  getDockIconOffset: () => { x: number; y: number } | null,
  still = false,
): TargetAndTransition {
  const leave = () => {
    if (still) return { opacity: 0, transition: LEAVE };
    const mark = getDockIconOffset();
    return {
      scale: mark ? 0.1 : 0.95,
      opacity: 0,
      x: mark?.x ?? 0,
      y: mark?.y ?? 0,
      transition: mark ? FLIGHT : LEAVE,
    };
  };
  // The public `exit` prop type doesn't include lazy resolvers even though
  // the runtime supports them, hence the cast.
  return leave as unknown as TargetAndTransition;
}

// The glow where a carried window would land, drawn over everything.
export function WindowFrameSnapZoneIndicator({
  snapZoneStyle,
}: {
  snapZoneStyle: {
    top: number;
    left: number;
    width: number;
    height: number;
  } | null;
}) {
  // Drawn over the page, which the server has none of.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {snapZoneStyle && (
        <motion.div
          key="snap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: LEAVE }}
          transition={FAST}
          className="pointer-events-none fixed z-[9999]"
          style={{
            top: snapZoneStyle.top,
            left: snapZoneStyle.left,
            width: snapZoneStyle.width,
            height: snapZoneStyle.height,
          }}
        >
          {/* The accent, as BoardUI rings what is chosen, on exactly the
              ground and the corners the window will take. */}
          <div
            className="size-full rounded-3xl"
            style={{
              border:
                "2px solid color-mix(in srgb, var(--color-accent-500) 80%, transparent)",
              backgroundColor:
                "color-mix(in srgb, var(--color-accent-500) 20%, transparent)",
              boxShadow:
                "0 0 20px color-mix(in srgb, var(--color-accent-500) 30%, transparent), inset 0 0 20px color-mix(in srgb, var(--color-accent-500) 10%, transparent)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
