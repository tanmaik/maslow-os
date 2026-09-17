"use client";

import { getLocalTimeZone, startOfMonth, today } from "@internationalized/date";
import type { CalendarDate } from "@internationalized/date";
import { format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import {
  CalendarMonthGrid,
  type CalendarGridItem,
} from "@/components/application/calendar/calendar-month-grid";
import { CalendarMonthSwitcher } from "@/components/application/calendar/calendar-month-switcher";

import { recordHref, typeColor } from "../format";
import { monthOf } from "./month";
import { WHEN, type Row } from "./query";

// The records of a month laid on the days they were written, or on a date
// field the person picked instead, on the calendar block's own switcher and grid.
// A record opens from its chip.
export function CalendarView({
  rows,
  on,
  fields,
  capped,
}: {
  rows: Row[];
  // The field the records are laid on: when they were written, or a date one.
  on: string;
  // The date fields this type declares, which the records could be laid on.
  fields: string[];
  // Whether the month holds more than the door answered with, so a busy
  // month never quietly loses its days.
  capped: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = monthOf(params.get("month") ?? undefined);
  const [highlighted, setHighlighted] = useState<CalendarDate | null>(null);
  // The server has no zone and lays an instant on its UTC day; the browser
  // lays it again on its own, as the day bands of the list do.
  const [here, setHere] = useState(false);
  useEffect(() => setHere(true), []);

  const go = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    next.delete("cursor");
    change(next);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const setMonth = (to: CalendarDate) =>
    go((next) =>
      next.set("month", `${to.year}-${String(to.month).padStart(2, "0")}`),
    );

  // With no month named, the address takes the browser's: the server sits
  // in its own zone and, near a date line, in another month than the
  // person reading, and that month is what the door is asked for.
  useEffect(() => {
    if (params.get("month")) return;
    const mine = startOfMonth(today(getLocalTimeZone()));
    if (mine.year !== month.year || mine.month !== month.month) setMonth(mine);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Which day a record falls on: a date field is already a day, and an
  // instant is a day in whoever is reading's own zone.
  const dayOf = (r: Row): string | null => {
    if (on !== WHEN) {
      const v = r.props[on];
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)
        ? v.slice(0, 10)
        : null;
    }
    if (!r.at) return null;
    const at = new Date(r.at);
    return here ? format(at, "yyyy-MM-dd") : at.toISOString().slice(0, 10);
  };
  const byDay = useMemo(() => {
    const days = new Map<string, Row[]>();
    for (const r of rows) {
      const day = dayOf(r);
      if (day) days.set(day, [...(days.get(day) ?? []), r]);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, on, here]);

  const items = (date: CalendarDate): CalendarGridItem[] =>
    (byDay.get(date.toString()) ?? []).map((r) => ({
      id: r.id,
      title: r.title || "(untitled)",
      color: typeColor(r.type),
      href: recordHref(r.id),
    }));

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(month.toDate(getLocalTimeZone()));

  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CalendarMonthSwitcher
          month={month}
          monthLabel={monthLabel}
          onPrevMonth={() => setMonth(month.subtract({ months: 1 }))}
          onNextMonth={() => setMonth(month.add({ months: 1 }))}
          onSelectDate={(date) => {
            setMonth(startOfMonth(date));
            setHighlighted(date);
          }}
        />
        {fields.length > 0 && (
          <div className="flex items-center gap-1">
            {[WHEN, ...fields].map((name) => (
              <Button
                key={name}
                variant={on === name ? "primary" : "secondary"}
                size="small"
                onClick={() =>
                  go((next) =>
                    name === WHEN ? next.delete("on") : next.set("on", name),
                  )
                }
              >
                {name}
              </Button>
            ))}
          </div>
        )}
      </div>
      {capped && (
        <p className="text-caption-1-regular text-text-secondary">
          This month holds more than the {rows.length} shown. Narrow it, or look
          at it as a list.
        </p>
      )}
      <div className="min-h-0 flex-1 rounded-3xl bg-background-secondary-default p-3">
        <CalendarMonthGrid
          month={month}
          highlightedDate={highlighted}
          onHighlightEnd={() => setHighlighted(null)}
          items={items}
        />
      </div>
    </div>
  );
}
