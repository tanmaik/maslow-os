"use client";

import { useEffect, useState, type ReactNode } from "react";

// A run of records under a heading, and how one is drawn: a quiet line
// over its rows, as a notes app names a day.
export const BAND =
  "flex items-center gap-3 px-5 pt-4 pb-1.5 text-caption-1-semibold text-text-secondary";

// Records cut into the days they happened, named in the reader's own zone.
// The server has no zone, so it names them in UTC and the browser cuts them
// again where its own day falls; a record at one in the morning in London
// is the evening before in Los Angeles, and reads under that evening.
export function Days({
  rows,
}: {
  rows: { id: string; at: string; row: ReactNode }[];
}) {
  const [here, setHere] = useState(false);
  useEffect(() => setHere(true), []);
  const zone = here ? {} : { timeZone: "UTC" };
  const named = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...zone,
  });
  const yeared = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...zone,
  });
  const dated = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...zone,
  });
  // The days nearest now are named as a person names them; a day of
  // another year carries its year, since a December could be either.
  // The days either side of today are counted on the calendar, not in
  // hours, since a day that starts or ends summer time is not 24 of them.
  const today = dated.format(new Date());
  const shifted = (key: string, days: number) => {
    const [y, m, d] = key.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const tomorrow = shifted(today, 1);
  const yesterday = shifted(today, -1);
  const thisYear = today.slice(0, 4);
  const head = (at: Date, key: string) =>
    key === today
      ? "Today"
      : key === tomorrow
        ? "Tomorrow"
        : key === yesterday
          ? "Yesterday"
          : key.slice(0, 4) === thisYear
            ? named.format(at)
            : yeared.format(at);
  const bands: { key: string; head: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const at = new Date(r.at);
    const key = dated.format(at);
    const band = bands.at(-1);
    if (band?.key === key) band.rows.push(r);
    else bands.push({ key, head: head(at, key), rows: [r] });
  }
  return (
    <>
      {bands.map((band) => (
        <div key={band.key} className="flex flex-col">
          <div className={BAND}>{band.head}</div>
          {band.rows.map((r) => r.row)}
        </div>
      ))}
    </>
  );
}
