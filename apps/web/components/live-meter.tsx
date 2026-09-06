"use client";

import { useEffect, useState } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { dollars, rate, SOURCE, spent } from "@/lib/prices";

type Live = {
  at: string;
  month: number;
  ratePerHour: number;
  active: { resource: string; ratePerHour: number }[];
};

// What the month comes to if the rate of the last minute holds.
const projected = (month: number, ratePerHour: number) => {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return month + (ratePerHour * (end - now.getTime())) / 3600_000;
};

// The cost of being here, as one labelled figure: what this person's
// computer, disk, bucket and brain would come to this month at this rate.
// Reads the meter every ten seconds; hover for what it counts, the month
// so far, the rate and the top three sources. Nobody is billed yet.
export function LiveMeter() {
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    let stop = false;
    let reads = 0;
    const read = async () => {
      const mine = ++reads;
      const r = await fetch("/meter/live", { cache: "no-store" });
      if (r.status === 401 || !r.ok) return;
      const l = (await r.json()) as Live;
      // Only the newest read may speak; a slow one is ignored.
      if (!stop && mine === reads) setLive(l);
    };
    void read();
    const poll = setInterval(read, 10_000);
    return () => {
      stop = true;
      clearInterval(poll);
    };
  }, []);

  if (!live) return null;
  const estimate = projected(live.month, live.ratePerHour);
  const top = [...live.active]
    .sort((x, y) => y.ratePerHour - x.ratePerHour)
    .slice(0, 3);
  const row = (label: string, value: string) => (
    <li key={label} className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </li>
  );
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
        {`Yours · ≈ ${dollars(estimate)} / month`}
      </HoverCardTrigger>
      <HoverCardContent align="start" side="bottom" className="w-72 text-sm">
        <p className="mb-2 font-medium">What you are using</p>
        <ul className="space-y-1">
          {row("So far this month", spent(live.month))}
          {row("Right now", rate(live.ratePerHour))}
          {top.map((a) =>
            row(
              SOURCE[a.resource as keyof typeof SOURCE] ?? a.resource,
              rate(a.ratePerHour),
            ),
          )}
        </ul>
        <p className="text-muted-foreground mt-2 text-xs">
          Nothing is charged yet.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
