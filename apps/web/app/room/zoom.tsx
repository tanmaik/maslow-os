"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

const STEP = 0.1;
const LEAST = 0.5;
const MOST = 1.5;

// The canvas at the size the person set it to, with the control that sets
// it in the corner. Zoomed out, the canvas widens to keep filling the
// screen; nothing is remembered between visits.
export function Zoom({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const to = (z: number) =>
    setZoom(Math.round(Math.min(MOST, Math.max(LEAST, z)) * 10) / 10);
  return (
    <>
      <div className="overflow-x-hidden">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            width: `${100 / zoom}%`,
          }}
        >
          {children}
        </div>
      </div>
      <div className="bg-card fixed right-20 bottom-6 z-40 flex h-9 items-center gap-0.5 rounded-full border px-1 shadow-lg">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Zoom out"
          onClick={() => to(zoom - STEP)}
        >
          <MinusIcon />
        </Button>
        <span className="text-muted-foreground min-w-10 text-center text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label="Zoom in"
          onClick={() => to(zoom + STEP)}
        >
          <PlusIcon />
        </Button>
      </div>
    </>
  );
}
