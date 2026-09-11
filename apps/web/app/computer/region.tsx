"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUDGET_MS, REGIONS, regionName, type Region } from "@/lib/region";

// Where the person is, as their request said: the address it came from,
// the city that address is in when known, and the region nearest it.
export type From = { ip: string; city: string | null; region: Region };

// How many round trips are timed, after one to open the connection, and
// the shortest is the one that counts.
const TRIPS = 5;

// Where the computer is and where the person is, in plain numbers: the
// region it is in with the round trip to it measured from this browser,
// the address the person is at and the region nearest to that, and a
// move, which only the person starts.
export function Where({
  current,
  door,
  from,
}: {
  current: string;
  // The computer's own address, which the round trip is measured to.
  door: string;
  from: From;
}) {
  const [ms, setMs] = useState<number | null | "no">(null);
  useEffect(() => {
    let stopped = false;
    const trip = async () => {
      const t = performance.now();
      await fetch(`${door}/maslow/health?${t}`, {
        mode: "no-cors",
        cache: "no-store",
      });
      return performance.now() - t;
    };
    (async () => {
      try {
        await trip();
        let best = Infinity;
        for (let i = 0; i < TRIPS; i++) best = Math.min(best, await trip());
        if (!stopped) setMs(Math.round(best));
      } catch {
        if (!stopped) setMs("no");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [door]);
  const [picked, setPicked] = useState<Region>(
    from.region === current ? (Object.keys(REGIONS)[0] as Region) : from.region,
  );
  const far = typeof ms === "number" && ms > BUDGET_MS;
  const nearer = from.region !== current;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Where</p>
      {far && (
        <Alert>
          <AlertTitle>Your computer is far from you.</AlertTitle>
          <AlertDescription>
            A round trip of {ms} ms; under {BUDGET_MS} feels like a terminal.
            {nearer
              ? ` ${regionName(from.region)} is nearest to you: move it there below.`
              : " Nothing nearer to you is on the list; pick a region below if you know better."}
          </AlertDescription>
        </Alert>
      )}
      <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Your computer</dt>
        <dd>
          {regionName(current)}
          {ms === null
            ? ", measuring the round trip…"
            : ms === "no"
              ? ", round trip could not be measured"
              : `, round trip ${ms} ms, measured from this browser`}
        </dd>
        <dt className="text-muted-foreground">You</dt>
        <dd>
          {from.ip}
          {from.city ? `, near ${from.city}` : ""}
        </dd>
        <dt className="text-muted-foreground">Nearest to you</dt>
        <dd>{regionName(from.region)}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={picked}
          onValueChange={(v) => setPicked(v as Region)}
          items={Object.fromEntries(
            Object.entries(REGIONS).map(([code, r]) => [code, r.name]),
          )}
        >
          <SelectTrigger aria-label="Region to move to">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(REGIONS) as Region[]).map((code) => (
              <SelectItem key={code} value={code} disabled={code === current}>
                {REGIONS[code].name}
                {code === current ? ", now" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="outline" disabled={picked === current} />}
          >
            Move to {regionName(picked)}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form action="/computer/move" method="post" className="contents">
              <input type="hidden" name="region" value={picked} />
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Move to {regionName(picked)}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This takes a few minutes: your computer stops, its disk is
                  copied to {regionName(picked)}, and it starts there. Your
                  files, your packages and your whole Linux come with it;
                  anything running stops. If anything goes wrong on the way it
                  comes back on where it is now.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it here</AlertDialogCancel>
                <AlertDialogAction type="submit">Move</AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <p className="text-muted-foreground text-sm">
        Nothing moves your computer but this button.
      </p>
    </div>
  );
}
