"use client";

import { useEffect, useRef, useState } from "react";

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { applyThemeWithTransition } from "@/components/application/theme/theme-toggle";
import { LOOK, type Look } from "@/components/look";

// Which look the page wears: the device's, or light or dark whatever the
// device says, kept on this device. The change spreads as one soft circle
// out of the segment that was pressed, BoardUI's own reveal.
export function LookPicker() {
  const [look, setLook] = useState<Look>("system");
  const from = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const kept = localStorage.getItem(LOOK);
    if (kept === "light" || kept === "dark") setLook(kept);
  }, []);
  const pick = (to: Look) => {
    setLook(to);
    const dark =
      to === "dark" ||
      (to === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    void applyThemeWithTransition(dark ? "dark" : "light", {
      element: from.current,
    });
    // The device's own is the absence of a pick, which the reveal cannot
    // say for itself; it writes light or dark, and this takes it back.
    if (to === "system") localStorage.removeItem(LOOK);
    document.documentElement.classList.toggle("dark", dark);
  };
  return (
    <SegmentedControl
      aria-label="Look"
      selectedKeys={[look]}
      onPointerDown={(e) => {
        from.current = e.target as HTMLElement;
      }}
      onSelectionChange={(keys) => {
        const to = [...keys][0];
        if (to === "system" || to === "light" || to === "dark") pick(to);
      }}
    >
      <SegmentedControlItem id="system">Like the device</SegmentedControlItem>
      <SegmentedControlItem id="light">Light</SegmentedControlItem>
      <SegmentedControlItem id="dark">Dark</SegmentedControlItem>
    </SegmentedControl>
  );
}
