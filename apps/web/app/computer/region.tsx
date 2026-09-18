"use client";

import { useCallback, useEffect, useState } from "react";

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
import { Button } from "@/components/base/buttons/button";
import { Notification } from "@/components/base/notification/notification";
import { Select, SelectItem } from "@/components/base/select/select";
import { Row, Rows } from "@/app/settings/row";
import { BUDGET_MS, REGIONS, regionName, type Region } from "@/lib/region";

// Where the person is, as their request said: the address it came from,
// the city that address is in when known, and the region nearest it.
export type From = { ip: string; city: string | null; region: Region };

// A round trip timed again and again while the pane is open, with the
// last minute of readings kept: the latest is what it feels like now, and
// the best is the wire itself with the noise taken out.
type Trip = { now: number | null; best: number | null; failed: boolean };
function useTrip(measure: () => Promise<number>, every: number): Trip {
  const [trips, setTrips] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    const keep = Math.ceil(60_000 / every);
    const go = async () => {
      try {
        const ms = await measure();
        if (stopped) return;
        setTrips((was) => [...was, ms].slice(-keep));
        setFailed(false);
      } catch {
        if (!stopped) setFailed(true);
      }
      if (!stopped) setTimeout(go, every);
    };
    void go();
    return () => {
      stopped = true;
    };
  }, [measure, every]);
  return {
    now: trips.at(-1) ?? null,
    best: trips.length ? Math.min(...trips) : null,
    failed,
  };
}

// How long one request takes from this browser, in milliseconds.
async function timed(url: string, init?: RequestInit): Promise<number> {
  const t = performance.now();
  const res = await fetch(url, { cache: "no-store", ...init });
  if (init?.mode !== "no-cors" && !res.ok) throw new Error(res.statusText);
  return Math.round(performance.now() - t);
}

// A trip's numbers as the row shows them: the latest, and the best of the
// minute where it differs.
function Ms({ trip }: { trip: Trip }) {
  return (
    <span className="text-body-regular text-text-primary tabular-nums">
      {trip.now === null
        ? trip.failed
          ? "Could not be measured"
          : "Measuring…"
        : `${trip.now} ms`}
      {trip.best !== null && trip.best !== trip.now && (
        <span className="text-caption-1-regular text-text-secondary">
          , best {trip.best}
        </span>
      )}
    </span>
  );
}

// Where the computer is and where the person is, in plain numbers: the
// three trips a moment at the desk pays, each timed live and named for
// what rides on it; the region it is in; the address the person is at and
// the region nearest to that; and a move, which only the person starts.
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
  // Straight from this browser to the computer: what a keystroke in the
  // terminal, a word to the Agent and the machine's browser ride on.
  const toComputer = useTrip(
    useCallback(
      () => timed(`${door}/maslow/health?${Date.now()}`, { mode: "no-cors" }),
      [door],
    ),
    2_000,
  );
  // From this browser to Maslow: what every click on a page and every read
  // of the brain pays, once.
  const toMaslow = useTrip(
    useCallback(() => timed(`/ping?${Date.now()}`), []),
    5_000,
  );
  // From Maslow to the computer, timed by our server: what Files, the
  // desktop's ports and these numbers pay on top of the trip to Maslow.
  const viaMaslow = useTrip(
    useCallback(async () => {
      const res = await fetch("/computer/ping", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      return ((await res.json()) as { ms: number }).ms;
    }, []),
    5_000,
  );
  const [picked, setPicked] = useState<Region>(
    from.region === current ? (Object.keys(REGIONS)[0] as Region) : from.region,
  );
  const wire = toComputer.best;
  const far = wire !== null && wire > BUDGET_MS;
  const nearer = from.region !== current;
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-caption-1-medium text-text-secondary">
        How fast it feels
      </p>
      {wire !== null && !far && (
        <p className="px-3 text-body-regular text-text-primary">
          Like a terminal: {wire} ms to your computer at best, under the{" "}
          {BUDGET_MS} a keystroke needs.
        </p>
      )}
      {far && (
        <Notification
          status="information"
          dismissible={false}
          title="Your computer is far from you"
          description={`${wire} ms to your computer at best; under ${BUDGET_MS} feels like a terminal.${
            nearer
              ? ` ${regionName(from.region)} is nearest to you: move it there below.`
              : " Nothing nearer to you is on the list; pick a region below if you know better."
          }`}
        />
      )}
      <Rows>
        <Row
          label="You to your computer"
          description="Every keystroke in the terminal, every word to the Agent and every frame of its browser go straight there from this browser and back."
        >
          <Ms trip={toComputer} />
        </Row>
        <Row
          label="You to Maslow"
          description="Every click on a page and every read of the brain goes to our server in Ohio and back, once."
        >
          <Ms trip={toMaslow} />
        </Row>
        <Row
          label="Maslow to your computer"
          description="Files, the ports on the desktop and the numbers on this pane are asked of your computer by our server, on top of the trip to it."
        >
          <Ms trip={viaMaslow} />
        </Row>
      </Rows>
      <p className="px-3 pt-3 text-caption-1-medium text-text-secondary">
        Where
      </p>
      <Rows>
        <Row label="Your computer">
          <span className="text-body-regular text-text-primary">
            {regionName(current)}
          </span>
        </Row>
        <Row
          label="Where you are"
          description={from.city ? `Near ${from.city}` : undefined}
        >
          <span className="text-body-regular text-text-primary">
            {regionName(from.region)}
          </span>
        </Row>
        <Row
          label="Move"
          description="Nothing moves your computer but this button."
        >
          <Select
            aria-label="Region to move to"
            size="sm"
            selectedKey={picked}
            onSelectionChange={(k) => k !== null && setPicked(k as Region)}
            triggerClassName="h-8"
          >
            {(Object.keys(REGIONS) as Region[]).map((code) => (
              <SelectItem key={code} id={code} isDisabled={code === current}>
                {REGIONS[code].name}
                {code === current ? ", now" : ""}
              </SelectItem>
            ))}
          </Select>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="secondary"
                  size="small"
                  disabled={picked === current}
                />
              }
            >
              Move
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
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction type="submit">Move</AlertDialogAction>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </Row>
      </Rows>
    </div>
  );
}
