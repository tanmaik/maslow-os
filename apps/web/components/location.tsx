"use client";

import { useEffect, useRef } from "react";

// Whether this device has answered the browser's own prompt: "on" once
// granted, "off" once declined or unanswered, and unset before it has ever
// been asked. Frames of the same page (Settings is one, the desktop is
// another) are told of a change through storage.
const LOCATION_KEY = "maslow.location";

function keepLocation(on: boolean) {
  const value = on ? "on" : "off";
  // Only a change is told: the minute's own reading writes what is already
  // there, and a frame that heard it would read the position again at once
  // rather than on the minute.
  try {
    if (window.localStorage.getItem(LOCATION_KEY) === value) return;
    window.localStorage.setItem(LOCATION_KEY, value);
  } catch {
    // A frame with no storage of its own has nothing to keep.
  }
}

// How often the position is read while the desktop is open and looked at.
const EVERY = 60_000;

// A door's ticket is good for an hour; a new one is minted before it runs
// out rather than on every minute's line.
const TICKET_FOR = 55 * 60_000;

// One position, read once: the browser's own permission is the only
// dialog, ten seconds to answer, and nothing sharper than a phone's coarse
// fix.
function positionOnce(): Promise<GeolocationPosition | "refused" | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve("refused");
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      // Only a refusal is remembered; a fix that took too long is tried
      // again next time.
      (err) => resolve(err.code === err.PERMISSION_DENIED ? "refused" : null),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  });
}

// Where the door takes the person's location, minted fresh once the last
// one has run most of its hour. Null where there is no ready computer.
async function doorFor(): Promise<{ door: string; ticket: string } | null> {
  const res = await fetch("/computer/location", { method: "POST" }).catch(
    () => null,
  );
  if (!res?.ok) return null;
  return (await res.json()) as { door: string; ticket: string };
}

// One line to the person's own machine: their position, sent straight to
// the door and never through us.
function report(
  pos: GeolocationPosition,
  to: { door: string; ticket: string },
) {
  void fetch(to.door, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-maslow-ticket": to.ticket,
    },
    body: JSON.stringify({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy),
    }),
  }).catch(() => {});
}

// The person's location, logged to their own machine: read through the
// browser's own permission once a minute while the desktop is open and
// looked at, at once on landing and on coming back into view, and never
// asked again on this device once refused. Off where this deployment
// makes no computers, since there is no door to carry it to.
export function useLocation(computers: boolean): void {
  const target = useRef<{
    at: number;
    got: { door: string; ticket: string };
  } | null>(null);

  useEffect(() => {
    if (!computers) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const doorTicket = async () => {
      const had = target.current;
      if (had && Date.now() - had.at < TICKET_FOR) return had.got;
      const got = await doorFor();
      if (got) target.current = { at: Date.now(), got };
      return got;
    };

    const ask = async () => {
      if (document.hidden || stopped) return;
      if (localStorage.getItem(LOCATION_KEY) === "off") return;
      const pos = await positionOnce();
      if (stopped) return;
      if (pos === "refused") return keepLocation(false);
      if (!pos) return;
      keepLocation(true);
      const to = await doorTicket();
      if (!stopped && to) report(pos, to);
    };

    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(look, EVERY);
    };
    const look = () => void ask().finally(soon);

    document.addEventListener("visibilitychange", look);
    look();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
    };
  }, [computers]);
}
