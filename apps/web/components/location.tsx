"use client";

import { useEffect, useRef, useState } from "react";

// Whether this device has answered the browser's own prompt: "on" once
// granted, "off" once declined, unanswered, or turned off in Settings, and
// unset before it has ever been asked. The ask and the weather can be in
// different frames of the same page (Settings is one, the desktop is
// another), so a change here is told to both.
const LOCATION_KEY = "maslow.location";

export function locationIsOn(): boolean {
  return localStorage.getItem(LOCATION_KEY) === "on";
}

function keepLocation(on: boolean) {
  const value = on ? "on" : "off";
  // Only a change is told: the minute's own reading writes what is already
  // there, and a frame that heard it would read the position again at once
  // rather than on the minute.
  try {
    if (window.localStorage.getItem(LOCATION_KEY) === value) return;
  } catch {
    // A frame with no storage of its own has nothing to compare.
  }
  const tell = (w: Window) => {
    try {
      w.localStorage.setItem(LOCATION_KEY, value);
      const Made = (w as unknown as { StorageEvent: typeof StorageEvent })
        .StorageEvent;
      w.dispatchEvent(
        new Made("storage", { key: LOCATION_KEY, newValue: value }),
      );
    } catch {
      // A frame we may not reach reads the key on its own next load.
    }
  };
  tell(window);
  if (window.parent !== window) tell(window.parent);
}

// The word Open-Meteo's condition becomes, for the mark and the tooltip
// beside the clock and the line in the log. Nothing here names an icon:
// that is the menu bar's to pick.
const CONDITIONS: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle",
  61: "rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "showers",
  81: "showers",
  82: "heavy showers",
  85: "snow showers",
  86: "snow showers",
  95: "thunderstorms",
  96: "thunderstorms",
  99: "thunderstorms",
};

export type Weather = {
  temperature: number | null;
  unit: "F" | "C";
  condition: string;
  place: string | null;
};

// How often the position and the weather are read while the desktop is open
// and being looked at.
const EVERY = 60_000;

// A door's ticket is good for an hour; a new one is minted before it runs
// out rather than on every minute's line.
const TICKET_FOR = 55 * 60_000;

// Fahrenheit for en-US, Celsius everywhere else.
const unitOf = (): "F" | "C" => (navigator.language === "en-US" ? "F" : "C");

// The weather where the browser says the person is, from Open-Meteo: no
// account, no key, asked straight from the browser. Null when it does not
// answer, so the mark is drawn alone.
async function weatherAt(
  latitude: number,
  longitude: number,
): Promise<Weather | null> {
  const unit = unitOf();
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set(
    "temperature_unit",
    unit === "F" ? "fahrenheit" : "celsius",
  );
  url.searchParams.set("timezone", "auto");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const said = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
      timezone?: string;
    };
    return {
      temperature:
        typeof said.current?.temperature_2m === "number"
          ? Math.round(said.current.temperature_2m)
          : null,
      unit,
      condition: CONDITIONS[said.current?.weather_code ?? -1] ?? "unknown",
      place: said.timezone?.split("/").pop()?.replace(/_/g, " ") ?? null,
    };
  } catch {
    return null;
  }
}

// One position, read once: the browser's own permission is the only
// dialog, ten seconds to answer, and nothing sharper than a phone's coarse
// fix, which is all the weather needs.
function positionOnce(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
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

// One line to the person's own machine: their position and, when it
// answered, the weather, sent straight to the door and never through us.
function report(
  pos: GeolocationPosition,
  weather: Weather | null,
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
      ...(weather?.temperature != null
        ? {
            temperature: weather.temperature,
            unit: weather.unit,
            condition: weather.condition,
          }
        : {}),
    }),
  }).catch(() => {});
}

// Asks the browser for the person's location, straight from wherever this
// is called: the row in Settings turning the switch on, or the desktop on its
// own the first time it is drawn. Granted, the row and the weather agree
// at once; refused, both stay off, and nothing asks again.
export async function askLocation(): Promise<boolean> {
  const pos = await positionOnce();
  keepLocation(!!pos);
  return !!pos;
}

export function turnLocationOff() {
  keepLocation(false);
}

// The weather beside the clock, and the minute that reports it. Reads the
// browser's own permission once a minute while the desktop is open and
// looked at, and at once on landing and on coming back into view. Off
// where this deployment makes no computers, since there is no door to
// carry a location to and no reset the "no fake" rule allows.
export function useWeatherClock(computers: boolean): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(null);
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
      if (localStorage.getItem(LOCATION_KEY) === "off") {
        setWeather(null);
        return;
      }
      const pos = await positionOnce();
      if (stopped) return;
      if (!pos) {
        keepLocation(false);
        setWeather(null);
        return;
      }
      keepLocation(true);
      const [now, to] = await Promise.all([
        weatherAt(pos.coords.latitude, pos.coords.longitude),
        doorTicket(),
      ]);
      if (stopped) return;
      setWeather(now);
      if (to) report(pos, now, to);
    };

    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(look, EVERY);
    };
    const look = () => void ask().finally(soon);

    const heard = (e: StorageEvent) => {
      if (e.key === LOCATION_KEY || e.key === null) look();
    };

    document.addEventListener("visibilitychange", look);
    window.addEventListener("storage", heard);
    look();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("storage", heard);
    };
  }, [computers]);

  return weather;
}
