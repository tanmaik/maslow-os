"use client";

import { CalendarDate, parseDate } from "@internationalized/date";
import { format, isValid, parseISO, set } from "date-fns";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { DatePicker } from "@/components/base/date-picker/date-picker";
import { Input } from "@/components/base/input/input";

const DAY = "yyyy-MM-dd";

// The instant a day and a clock time name in the reader's zone, or nothing
// when the clock is blank or that time does not exist on that day.
function instant(day: Date, clock: string): Date | undefined {
  const [h, m] = clock.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return undefined;
  const d = set(day, { hours: h, minutes: m, seconds: 0, milliseconds: 0 });
  return d.getHours() === h && d.getMinutes() === m ? d : undefined;
}

// A day as the calendar holds it, and back as a date in the reader's zone.
const toCalendar = (d: Date) => parseDate(format(d, DAY));
const fromCalendar = (c: CalendarDate) => new Date(c.year, c.month - 1, c.day);

// A day, or a day and a time, picked from a calendar and posted as one
// input: 2026-09-04 for a day, an instant for a time. Left untouched, it
// posts exactly what it was given. onChange hears each new value.
export function DateField({
  id,
  name,
  defaultValue,
  time = false,
  required = false,
  onChange,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  time?: boolean;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const given = defaultValue ? parseISO(defaultValue) : undefined;
  const initial = given && isValid(given) ? given : undefined;
  const initialClock = initial && time ? format(initial, "HH:mm") : "09:00";
  const [date, setDate] = useState<Date | undefined>(initial);
  const [clock, setClock] = useState(initialClock);
  const untouched =
    initial &&
    date &&
    format(date, DAY) === format(initial, DAY) &&
    clock === initialClock;
  const picked = date && time ? instant(date, clock) : date;
  const value = untouched
    ? defaultValue!
    : !picked
      ? ""
      : time
        ? picked.toISOString()
        : format(picked, DAY);
  const heard = useRef(value);
  useEffect(() => {
    if (value !== heard.current) {
      heard.current = value;
      onChange?.(value);
    }
  }, [value, onChange]);
  return (
    <div className="flex flex-wrap items-center gap-2" id={id}>
      <input
        type="text"
        name={name}
        value={value}
        onChange={() => {}}
        required={required}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
      <DatePicker
        aria-label="Day"
        className="h-9 py-0"
        value={date ? toCalendar(date) : null}
        onChange={(c) => setDate(c ? fromCalendar(c) : undefined)}
      />
      {time && date && (
        <Input
          size="small"
          type="time"
          value={clock}
          onChange={setClock}
          isRequired
          isInvalid={!picked}
          aria-label="Time"
          className="w-28"
        />
      )}
      {date && (
        <Button
          size="small"
          type="button"
          variant="secondary"
          onClick={() => setDate(undefined)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
