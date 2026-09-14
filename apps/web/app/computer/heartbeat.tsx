"use client";

import { RiPlayLine } from "@remixicon/react";
import { useRef, useState } from "react";

import { Row, Rows } from "@/app/settings/row";
import { Button } from "@/components/base/buttons/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import type { Heartbeat as Beat } from "@/lib/fly";
import { EVERY } from "@/lib/heartbeat";

// A moment ago, in the person's own words.
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// How long a run took, in the person's own words.
const took = (ms: number) =>
  ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;

// The person's agent running on its own on their computer: how often, a
// run now, and what came of the last. The cadence is theirs to set, and
// off is a cadence; the machine says whether one is going and when the
// last one ran.
export function Heartbeat({
  every: was,
  now,
}: {
  every: number;
  now: Beat | null;
}) {
  const [every, setEvery] = useState(was);
  // Changes go one after another, in the order they were picked, and the
  // one on screen is the last picked until a save of it fails; then it
  // goes back to the last that saved.
  const saves = useRef(Promise.resolve());
  const saved = useRef(was);
  const picked = useRef(was);
  // What the last change left to say: a change written but not yet on
  // the computer, or one that did not happen.
  const [said, setSaid] = useState<{ kept: boolean; text: string } | null>(
    null,
  );
  const [asked, setAsked] = useState(false);
  const running = now?.running ?? null;
  const last = now?.last ?? null;
  const set = (to: number) => {
    setSaid(null);
    picked.current = to;
    setEvery(to);
    saves.current = saves.current.then(async () => {
      try {
        const res = await fetch("/computer/heartbeat", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ every: to }),
        });
        if (!res.ok && res.status !== 202) throw new Error(await res.text());
        saved.current = to;
        if (res.status === 202 && picked.current === to)
          setSaid({ kept: true, text: await res.text() });
      } catch (err) {
        if (picked.current !== to) return;
        picked.current = saved.current;
        setEvery(saved.current);
        setSaid({ kept: false, text: (err as Error).message });
      }
    });
  };
  const run = async () => {
    setSaid(null);
    setAsked(true);
    try {
      const res = await fetch("/computer/heartbeat", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      setSaid({ kept: false, text: (err as Error).message });
    } finally {
      // The machine says it is running within a few seconds; until then
      // the button stays pressed.
      setTimeout(() => setAsked(false), 6000);
    }
  };
  return (
    <Rows>
      <Row
        label="Heartbeat"
        description={
          running
            ? `Running now, since ${ago(running)}. Your agent runs on its own on your computer, as you, with your brain and your apps.`
            : last
              ? `Last ran ${ago(last.at)} and took ${took(last.took)}${last.ok ? "" : ", but did not finish"}. Your agent runs on its own on your computer, as you, with your brain and your apps.`
              : "Your agent runs on its own on your computer, as you, with your brain and your apps. It has not run yet."
        }
      >
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SegmentedControl
            aria-label="How often"
            selectedKeys={[String(every)]}
            onSelectionChange={(keys) => {
              const to = Number([...keys][0]);
              if (EVERY.some((e) => e.minutes === to)) set(to);
            }}
          >
            {EVERY.map((e) => (
              <SegmentedControlItem key={e.minutes} id={String(e.minutes)}>
                {e.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <Button
            variant="secondary"
            size="small"
            leadingIcon={RiPlayLine}
            disabled={running !== null || asked}
            onClick={() => void run()}
          >
            Run now
          </Button>
        </div>
      </Row>
      {last && !last.ok && !running && last.said && (
        <Row label="What the last run said" description={last.said}>
          <span />
        </Row>
      )}
      {said && (
        <Row
          label={said.kept ? "Written down" : "That did not happen"}
          description={said.text}
        >
          <span />
        </Row>
      )}
    </Rows>
  );
}
