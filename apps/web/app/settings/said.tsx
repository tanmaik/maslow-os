"use client";

import { RiCheckboxCircleFill, RiErrorWarningFill } from "@remixicon/react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// What the last save left to say. A save that went through is a small
// notice, rising through the section's bottom edge for a moment and
// sinking back out the same edge; a refusal is a red line under the form,
// with the warning mark on it; anything else is a plain line.
export function Said({
  text,
  tone = "notice",
  className,
}: {
  text: string | null;
  /** "wrong" when the text says why the save was refused. */
  tone?: "notice" | "wrong";
  className?: string;
}) {
  const saved = text !== null && /^Saved[.,]/.test(text);
  const [phase, setPhase] = useState<"hidden" | "shown" | "leaving">("hidden");
  useEffect(() => {
    if (!saved) return;
    const up = requestAnimationFrame(() => setPhase("shown"));
    const off = setTimeout(() => setPhase("leaving"), 2200);
    const gone = setTimeout(() => setPhase("hidden"), 2350);
    return () => {
      cancelAnimationFrame(up);
      clearTimeout(off);
      clearTimeout(gone);
    };
  }, [saved, text]);
  if (!text) return null;
  if (!saved)
    return (
      <p
        aria-live="polite"
        className={cn(
          "flex items-center gap-1.5 text-xs",
          tone === "wrong" ? "text-destructive" : "text-muted-foreground",
          className,
        )}
      >
        {tone === "wrong" && (
          <RiErrorWarningFill className="size-4 shrink-0" aria-hidden />
        )}
        {text}
      </p>
    );
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1",
        "rounded-md border border-border bg-popover py-1 pr-2.5 pl-1.5 shadow-md",
        "transition-[opacity,translate]",
        phase === "shown" &&
          "translate-y-1/2 opacity-100 duration-base ease-out-quart",
        phase === "hidden" &&
          "translate-y-[calc(50%+8px)] opacity-0 duration-base ease-out-quart",
        phase === "leaving" &&
          "translate-y-[calc(50%+8px)] opacity-0 duration-fast ease-in-quad",
        "motion-reduce:translate-y-1/2",
      )}
    >
      <RiCheckboxCircleFill
        className="size-4 shrink-0 text-success"
        aria-hidden
      />
      <span className="text-xs font-medium whitespace-nowrap text-foreground">
        {text.replace(/\.$/, "")}
      </span>
    </div>
  );
}
