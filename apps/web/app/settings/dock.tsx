"use client";

import { useEffect, useState } from "react";

import { DOCK_SIZE, ICON_LARGEST, ICON_SMALLEST } from "@/app/room/dock";
import { Row } from "@/app/settings/row";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { Slider } from "@/components/base/slider/slider";
import { Switch } from "@/components/base/switch/switch";

// Where the dock lies and how it behaves, kept on this device. The desk
// keeps the same three keys under the same names (app/room/room.tsx).
const SIDE = "maslow.dock.side";
const HIDING = "maslow.dock.hiding";
const MAGNIFY = "maslow.dock.magnify";
const ICON_DEFAULT = 48;

type Side = "left" | "bottom" | "right";

// Keeps one setting and says so, on this page and on the desk holding it,
// so a change here reaches the dock without a reload.
function keep(key: string, value: string) {
  localStorage.setItem(key, value);
  const tell = (w: Window) => {
    try {
      const Made = (w as unknown as { StorageEvent: typeof StorageEvent })
        .StorageEvent;
      w.dispatchEvent(new Made("storage", { key, newValue: value }));
    } catch {
      // A desk we may not reach is a desk that reads the key on its next
      // load; nothing here is lost.
    }
  };
  tell(window);
  if (window.parent !== window) tell(window.parent);
}

// The dock, as rows of the Look pane: which edge it lies along, whether
// it gets out of the way, and whether its icons swell under the pointer.
export function DockRows() {
  const [side, setSide] = useState<Side>("bottom");
  const [hiding, setHiding] = useState(false);
  const [magnify, setMagnify] = useState(true);
  const [size, setSize] = useState(ICON_DEFAULT);
  useEffect(() => {
    const kept = localStorage.getItem(SIDE);
    if (kept === "left" || kept === "right") setSide(kept);
    setHiding(localStorage.getItem(HIDING) === "yes");
    setMagnify(localStorage.getItem(MAGNIFY) !== "no");
    const big = Number(localStorage.getItem(DOCK_SIZE));
    if (big >= ICON_SMALLEST && big <= ICON_LARGEST) setSize(big);
  }, []);
  const yesNo = (to: boolean) => (to ? "yes" : "no");
  return (
    <>
      <Row label="Dock position">
        <SegmentedControl
          aria-label="Where the dock lies"
          selectedKeys={[side]}
          onSelectionChange={(keys) => {
            const to = [...keys][0];
            if (to === "left" || to === "bottom" || to === "right") {
              setSide(to);
              keep(SIDE, to);
            }
          }}
        >
          <SegmentedControlItem id="left">Left</SegmentedControlItem>
          <SegmentedControlItem id="bottom">Bottom</SegmentedControlItem>
          <SegmentedControlItem id="right">Right</SegmentedControlItem>
        </SegmentedControl>
      </Row>
      <Row label="Dock size">
        {/* The number stands beside the slider rather than in a bubble over
            it, so the row keeps the height every other row has. */}
        <div className="flex items-center gap-2">
          <Slider
            aria-label="How big the dock's icons stand"
            thumbLabel="Dock size"
            minValue={ICON_SMALLEST}
            maxValue={ICON_LARGEST}
            step={4}
            value={size}
            onChange={(to) => {
              const one = Array.isArray(to) ? to[0] : to;
              setSize(one);
              keep(DOCK_SIZE, String(one));
            }}
            showTooltip={false}
            className="w-40"
          />
          <span className="w-10 text-right text-caption-1-regular text-text-secondary tabular-nums">
            {size}px
          </span>
        </div>
      </Row>
      <Row label="Hide the dock when not in use">
        <Switch
          size="sm"
          aria-label="Hide the dock when not in use"
          isSelected={hiding}
          onChange={(to) => {
            setHiding(to);
            keep(HIDING, yesNo(to));
          }}
        />
      </Row>
      <Row label="Make the icons swell">
        <Switch
          size="sm"
          aria-label="Make the icons swell"
          isSelected={magnify}
          onChange={(to) => {
            setMagnify(to);
            keep(MAGNIFY, yesNo(to));
          }}
        />
      </Row>
    </>
  );
}
