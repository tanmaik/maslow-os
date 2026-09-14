"use client";

import { RiCheckboxCircleFill, RiErrorWarningFill } from "@remixicon/react";
import { useEffect, useState } from "react";

import { cx } from "@/utils/cx";

// What the last save left to say. A save that went through is BoardUI's
// notification, rising through the well's bottom edge for a moment and
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
        className={cx(
          "flex items-center gap-1.5 text-body-2-regular",
          tone === "wrong" ? "text-text-error-primary" : "text-text-secondary",
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
      className={cx(
        "pointer-events-none absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1",
        "rounded-full border border-border-button-default bg-background-primary-default py-1 pr-2.5 pl-1.5 shadow-dropdown",
        "transition-[opacity,translate,scale,filter]",
        phase === "shown" &&
          "translate-y-1/2 scale-100 opacity-100 blur-none duration-base ease-out-quart",
        phase === "hidden" &&
          "translate-y-[calc(50%+12px)] scale-[0.97] opacity-0 blur-[4px] duration-base ease-out-quart",
        phase === "leaving" &&
          "translate-y-[calc(50%+8px)] scale-[0.96] opacity-0 blur-[3px] duration-fast ease-in-quad",
        "motion-reduce:translate-y-1/2 motion-reduce:scale-100 motion-reduce:blur-none",
      )}
    >
      <RiCheckboxCircleFill
        className="size-4 shrink-0 text-notification-success-foreground"
        aria-hidden
      />
      <span className="text-body-2-medium whitespace-nowrap text-text-primary">
        {text.replace(/\.$/, "")}
      </span>
    </div>
  );
}
