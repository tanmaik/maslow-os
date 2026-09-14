"use client";

import { useEffect, useState } from "react";

import type { Usage } from "@/lib/computer";
import { dayLabel, dayOf, dollars } from "@/lib/dollars";
import { cx } from "@/utils/cx";

// What the person has spent on models this week, against the ceiling that
// is theirs: the one limit of ours they are shown, in dollars. Read from
// `/usage`, which answers nothing where this deployment mints no keys, and
// then it says nothing either: one line with the bar as its underline, in
// the composer's status tab, opening onto the days.

// The week's spend, or null while it is being read or where there is none.
function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let live = true;
    const read = async () => {
      const res = await fetch("/usage", { cache: "no-store" }).catch(
        () => null,
      );
      if (!live) return;
      if (!res?.ok) return setUsage(null);
      setUsage((await res.json()) as Usage);
    };
    void read();
    // The sweep copies the key's spend at most once an hour; a minute is
    // often enough to catch the tab up after one.
    const every = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(every);
    };
  }, []);

  return usage;
}

// The days behind the week, newest last, as the breakdown reads them.
const daysOf = (usage: Usage) =>
  usage.days.slice(-14).map((d) => ({
    label: dayLabel(d.day),
    value: dollars(d.usd),
  }));

// One line for the composer's status tab: the week's dollars, the bar as
// the line's own underline, and the days under it when it is pressed.
export function UsageLine({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const usage = useUsage();
  if (!usage) return null;
  const reached = usage.spentUsd >= usage.capUsd;
  const share = usage.capUsd === 0 ? 0 : usage.spentUsd / usage.capUsd;
  const days = daysOf(usage);
  return (
    <div className={cx("flex min-w-0 flex-col", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex cursor-pointer flex-col gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <span
          className={cx(
            "text-body-2-regular whitespace-nowrap tabular-nums",
            reached ? "text-text-error-primary" : "text-text-secondary",
          )}
        >
          {reached
            ? `Weekly limit reached, resets ${dayOf(usage.resetsAt)}`
            : `${dollars(usage.spentUsd)} of ${dollars(usage.capUsd)} this week`}
        </span>
        <span className="h-0.5 w-full overflow-hidden rounded-full bg-chart-track">
          <span
            className="block h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.min(100, Math.max(0, share) * 100)}%`,
              backgroundColor: reached
                ? "var(--color-text-error-primary)"
                : "var(--color-accent-500)",
            }}
          />
        </span>
      </button>
      {open && days.length > 0 && (
        <div className="flex flex-col pt-1.5">
          {days.map((d) => (
            <div key={d.label} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate text-body-2-regular text-text-tertiary">
                {d.label}
              </span>
              <span className="text-body-2-medium text-text-secondary tabular-nums">
                {d.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
