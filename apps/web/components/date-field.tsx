"use client";

import { format, isValid, parseISO, set } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DAY = "yyyy-MM-dd";

// The instant a day and a clock time name in the reader's zone, or nothing
// when the clock is blank or that time does not exist on that day.
function instant(day: Date, clock: string): Date | undefined {
  const [h, m] = clock.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return undefined;
  const d = set(day, { hours: h, minutes: m, seconds: 0, milliseconds: 0 });
  return d.getHours() === h && d.getMinutes() === m ? d : undefined;
}

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
    <div className="flex flex-wrap items-center gap-2">
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
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="justify-start font-normal"
            />
          }
        >
          <CalendarIcon />
          {date ? (
            format(date, "d MMM yyyy")
          ) : (
            <span className="text-muted-foreground">Pick a day</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={setDate} />
        </PopoverContent>
      </Popover>
      {time && date && (
        <Input
          type="time"
          value={clock}
          onChange={(e) => setClock(e.target.value)}
          required
          aria-invalid={picked ? undefined : true}
          className="w-28"
          aria-label="time"
        />
      )}
      {date && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setDate(undefined)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
