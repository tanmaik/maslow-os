import {
  CalendarDate,
  getLocalTimeZone,
  startOfMonth,
} from "@internationalized/date";
import { format } from "date-fns";

// Which month a calendar is looking at and what it covers. Read by the page
// that asks the door for a month's records and by the grid that draws them,
// so both agree on where a month begins and ends.

// The month an address names, or the one we are in.
export const monthOf = (given: string | undefined): CalendarDate => {
  const m = /^(\d{4})-(\d{2})$/.exec(given ?? "");
  const now = new Date();
  return m
    ? new CalendarDate(Number(m[1]), Number(m[2]), 1)
    : new CalendarDate(now.getFullYear(), now.getMonth() + 1, 1);
};

// The days a month's grid draws: six whole weeks from the Sunday on or
// before the first, so every month is the same height.
export function monthGrid(month: CalendarDate): CalendarDate[] {
  const zone = getLocalTimeZone();
  const first = startOfMonth(month);
  const start = first.subtract({ days: first.toDate(zone).getDay() });
  const days: CalendarDate[] = [];
  for (let d = start; days.length < 42; d = d.add({ days: 1 })) days.push(d);
  return days;
}

// The six weeks a month's grid draws, as the instants they begin and end.
export function monthWindow(month: CalendarDate): [Date, Date] {
  const days = monthGrid(month);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return [
    new Date(first.year, first.month - 1, first.day),
    new Date(last.year, last.month - 1, last.day + 1),
  ];
}

// A day as a date field holds it: 2026-09-04.
export const dayValue = (d: Date) => format(d, "yyyy-MM-dd");
