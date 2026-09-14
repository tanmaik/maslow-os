"use client";

import { useEffect, useState, type ReactNode } from "react";

// A run of records under a heading, and how one is drawn: a table's header
// row, which the list sticks under its bar where the list is wide enough
// for the bar to be one row.
export const BAND =
  "z-10 flex items-center gap-4 border-y border-separator-border bg-background-secondary-default px-3 py-2 text-body-2-medium text-text-tertiary @[48rem]:sticky @[48rem]:top-15";

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
  const dated = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...zone,
  });
  const bands: { key: string; head: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const at = new Date(r.at);
    const key = dated.format(at);
    const band = bands.at(-1);
    if (band?.key === key) band.rows.push(r);
    else bands.push({ key, head: named.format(at), rows: [r] });
  }
  return (
    <>
      {bands.map((band) => (
        <div key={band.key} className="flex flex-col">
          <div className={BAND}>{band.head}</div>
          {band.rows.map((r) => (
            <div key={r.id} className="contents">
              {r.row}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
