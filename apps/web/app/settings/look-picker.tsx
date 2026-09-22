"use client";

import { useEffect, useState } from "react";

import { LOOK, type Look } from "@/components/look";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Which look the page wears: the device's, or light or dark whatever the
// device says, kept on this device.
export function LookPicker() {
  const [look, setLook] = useState<Look>("system");
  useEffect(() => {
    const kept = localStorage.getItem(LOOK);
    if (kept === "light" || kept === "dark") setLook(kept);
  }, []);
  const pick = (to: Look) => {
    setLook(to);
    const dark =
      to === "dark" ||
      (to === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    // The device's own is the absence of a pick.
    if (to === "system") localStorage.removeItem(LOOK);
    else localStorage.setItem(LOOK, to);
    document.documentElement.classList.toggle("dark", dark);
  };
  return (
    <ToggleGroup
      aria-label="Look"
      variant="outline"
      size="sm"
      spacing={0}
      value={[look]}
      onValueChange={([to]) => {
        if (to === "system" || to === "light" || to === "dark") pick(to);
      }}
    >
      <ToggleGroupItem value="system">Like the device</ToggleGroupItem>
      <ToggleGroupItem value="light">Light</ToggleGroupItem>
      <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    </ToggleGroup>
  );
}
