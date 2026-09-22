"use client";

import {
  CalendarDate,
  getLocalTimeZone,
  isSameDay,
  startOfMonth,
  today,
} from "@internationalized/date";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { recordPageHref, typeColor } from "../format";
import { useHere } from "../here";
import { monthGrid, monthOf } from "./month";
import { WHEN, type Row } from "./query";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// How many records a day names before it says how many more there are.
const SHOWN = 3;

// The records of a month laid on the days they were last changed, or on a
// date field the person picked instead. A record opens from its chip.
export function CalendarView({
  rows,
  on,
  fields,
  capped,
}: {
  rows: Row[];
  // The field the records are laid on: when they were last changed, or a
  // date one.
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
  const from = useHere();
  const month = monthOf(params.get("month") ?? undefined);
  const [highlighted, setHighlighted] = useState<CalendarDate | null>(null);
  const [picking, setPicking] = useState(false);
  // A day jumped to is marked for a moment, then is a day like any other.
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 1600);
    return () => clearTimeout(timer);
  }, [highlighted]);
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

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(month.toDate(getLocalTimeZone()));

  const now = today(getLocalTimeZone());

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => setMonth(month.subtract({ months: 1 }))}
          >
            <RiArrowLeftSLine />
          </Button>
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger
              render={<Button variant="ghost" size="sm" className="min-w-32" />}
            >
              {monthLabel}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                defaultMonth={month.toDate(getLocalTimeZone())}
                onSelect={(d) => {
                  if (!d) return;
                  const date = new CalendarDate(
                    d.getFullYear(),
                    d.getMonth() + 1,
                    d.getDate(),
                  );
                  setMonth(startOfMonth(date));
                  setHighlighted(date);
                  setPicking(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => setMonth(month.add({ months: 1 }))}
          >
            <RiArrowRightSLine />
          </Button>
        </div>
        {fields.length > 0 && (
          <ToggleGroup
            aria-label="Laid on"
            variant="outline"
            size="sm"
            spacing={0}
            value={[on]}
            onValueChange={([name]) => {
              if (!name || name === on) return;
              go((next) =>
                name === WHEN ? next.delete("on") : next.set("on", name),
              );
            }}
          >
            {[WHEN, ...fields].map((name) => (
              <ToggleGroupItem key={name} value={name}>
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
      {capped && (
        <p className="text-xs text-muted-foreground">
          This month has more than the {rows.length} shown. Add a filter, or
          switch to the list.
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-muted/60">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {monthGrid(month).map((date, i) => {
            const held = byDay.get(date.toString()) ?? [];
            const more = held.length - SHOWN;
            const outside = date.month !== month.month;
            return (
              <div
                key={date.toString()}
                className={cn(
                  "flex min-h-16 min-w-0 flex-col gap-1 border-border p-1 transition-colors duration-slow sm:min-h-24 sm:p-1.5",
                  i % 7 !== 6 && "border-r",
                  i < 35 && "border-b",
                  outside && "bg-muted/40",
                  highlighted &&
                    isSameDay(date, highlighted) &&
                    "bg-primary/10",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                    outside
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground",
                    isSameDay(date, now) &&
                      "bg-primary font-medium text-primary-foreground",
                  )}
                >
                  {date.day}
                </span>
                {held.slice(0, more > 0 ? SHOWN - 1 : SHOWN).map((r) => (
                  <EagerLink
                    key={r.id}
                    href={recordPageHref(r.id, from)}
                    title={r.title || "(untitled)"}
                    className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: typeColor(r.type) }}
                    />
                    <span className="truncate max-sm:sr-only">
                      {r.title || "(untitled)"}
                    </span>
                  </EagerLink>
                ))}
                {more > 0 && (
                  <span className="px-1 text-xs text-muted-foreground">
                    +{more + 1} more
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
