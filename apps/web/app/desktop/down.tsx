"use client";

import { useEffect, useState } from "react";

import { MOVE_STEPS, STEPS } from "@/app/computer/making";
import { Progress } from "@/components/ui/progress";
import type { State } from "@/lib/computer";

// The whole computer off while it is not answering: the desktop covered,
// so nothing on it is seen waiting or reconnecting, under one card that
// says what the computer is doing, asked after every three seconds; and
// once it is back, that it is, for the moment its windows take to open
// afresh.
export function Down({ back }: { back: boolean }) {
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
  const [value, words] = back
    ? ([100, "Opening your windows"] as const)
    : move
      ? MOVE_STEPS[move.step]
      : STEPS[progress === "ready" ? "starting" : progress];
  const step = move ? words.replace("_", move.toName) : words;
  const title = back
    ? "Your computer is back"
    : move
      ? "Your computer is moving"
      : progress === "disk" || progress === "machine"
        ? "Your computer is being made"
        : "Your computer is restarting";
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bg-black inset-0 z-[70] flex items-center justify-center select-none"
    >
      <div className="glass-solid border-separator-border flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-[12px] border p-5">
        <p className="text-headline-medium text-text-primary">{title}</p>
        <Progress aria-label={step} value={value} />
        <p className="text-body-regular text-text-secondary">
          {back
            ? `${step}.`
            : `${step}. Your windows come back as they were once it answers.`}
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
