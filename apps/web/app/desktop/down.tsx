"use client";

import { useEffect, useState } from "react";

import { MOVE_STEPS, STEPS } from "@/app/computer/making";
import { Progress } from "@/components/ui/progress";
import type { State } from "@/lib/computer";

// The whole desktop out of action while the computer is not answering:
// greyed under one card that says what the computer is doing, asked after
// every three seconds, until its door answers and the desktop clears.
export function Down() {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    let stopped = false;
    const ask = async () => {
      const res = await fetch("/computer/state", { method: "POST" }).catch(
        () => null,
      );
      const s = res?.ok
        ? ((await res.json().catch(() => null)) as State | null)
        : null;
      if (stopped) return;
      if (s) setState(s);
      setTimeout(ask, 3000);
    };
    void ask();
    return () => {
      stopped = true;
    };
  }, []);
  const progress = state?.progress ?? "starting";
  const move = state?.move ?? null;
  // A row that says ready over a silent door is a machine still coming.
  const [value, words] = move
    ? MOVE_STEPS[move.step]
    : STEPS[progress === "ready" ? "starting" : progress];
  const step = move ? words.replace("_", move.toName) : words;
  const title = move
    ? "Your computer is moving"
    : progress === "disk" || progress === "machine"
      ? "Your computer is being made"
      : "Your computer is restarting";
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-canvas/70 fixed inset-0 z-[70] flex items-center justify-center backdrop-blur-sm select-none"
    >
      <div className="glass-solid border-separator-border flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-[12px] border p-5">
        <p className="text-headline-medium text-text-primary">{title}</p>
        <Progress aria-label={step} value={value} />
        <p className="text-body-regular text-text-secondary">
          {step}. Everything comes back as it was once it answers.
        </p>
        {state?.failed && (
          <p className="text-body-regular text-text-error-primary">
            {state.failed}
          </p>
        )}
      </div>
    </div>
  );
}
