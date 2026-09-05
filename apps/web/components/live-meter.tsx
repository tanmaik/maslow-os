"use client";

import { useEffect, useState } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

type Live = {
  at: string;
  month: number;
  ratePerHour: number;
  active: { resource: string; what: string; ratePerHour: number }[];
};

// What the month comes to if the rate of the last minute holds.
const projected = (month: number, ratePerHour: number) => {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return month + (ratePerHour * (end - now.getTime())) / 3600_000;
};

const dollars = (n: number) =>
  n < 0.01 && n > 0 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;

// The cost of being here, ticking. Reads the meter every ten seconds and
// advances between reads at the rate the last minute showed; hover for
// what is ticking and how fast.
export function LiveMeter() {
  const [live, setLive] = useState<Live | null>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let stop = false;
    let reads = 0;
    const read = async () => {
      const mine = ++reads;
      const r = await fetch("/meter/live", { cache: "no-store" });
      if (r.status === 401 || !r.ok) return;
      const l = (await r.json()) as Live;
      // Only the newest read may speak; a slow one is ignored.
      if (!stop && mine === reads) {
        setLive(l);
        setShown(l.month);
      }
    };
    void read();
    const poll = setInterval(read, 10_000);
    return () => {
      stop = true;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const tick = setInterval(
      () => setShown((s) => s + live.ratePerHour / 3600),
      1000,
    );
    return () => clearInterval(tick);
  }, [live]);

  if (!live) return null;
  const estimate = projected(live.month, live.ratePerHour);
  const top = [...live.active]
    .sort((x, y) => y.ratePerHour - x.ratePerHour)
    .slice(0, 4);
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <a
            href="/usage"
            className="text-muted-foreground hover:text-foreground fixed top-2 right-3 z-50 font-mono text-xs tabular-nums"
            data-live-meter={live.month}
            data-estimate={estimate}
          />
        }
      >
        {dollars(shown)} / ≈{dollars(estimate)} a month
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 text-sm">
        <p className="mb-2 font-medium">Top sources of burn</p>
        {top.length === 0 ? (
          <p className="text-muted-foreground">Nothing is ticking.</p>
        ) : (
          <ul className="space-y-1">
            {top.map((a) => (
              <li key={a.resource} className="flex justify-between gap-2">
                <span>{a.what}</span>
                <span className="text-muted-foreground font-mono tabular-nums">
                  {dollars(a.ratePerHour)}/h
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          This month so far, then the month at this rate. Everything is on the
          usage page.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
