"use client";

import { useEffect, useState } from "react";

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
    <div className="flex flex-col gap-2">
      <p className="px-3 text-body-2-medium text-text-secondary">Where</p>
      {far && (
        <Notification
          status="information"
          dismissible={false}
          title="Your computer is far from you"
          description={`A round trip of ${ms} ms; under ${BUDGET_MS} feels like a terminal.${
            nearer
              ? ` ${regionName(from.region)} is nearest to you: move it there below.`
              : " Nothing nearer to you is on the list; pick a region below if you know better."
          }`}
        />
      )}
      <Rows>
        <Row
          label="Your computer"
          description={
            ms === null
              ? "Measuring the round trip…"
              : ms === "no"
                ? "The round trip could not be measured."
                : `Round trip ${ms} ms, measured from this browser.`
          }
        >
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
