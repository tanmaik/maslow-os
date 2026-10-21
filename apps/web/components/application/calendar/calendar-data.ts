import { CalendarDate } from "@internationalized/date";

// The six weeks a month's grid draws, Sunday first: the days before the
// first of the month that fill its first week, the month, and the days
// after that fill the sixth week.
export function monthGrid(month: CalendarDate): CalendarDate[] {
  const first = new CalendarDate(month.year, month.month, 1);
  const lead = new Date(first.year, first.month - 1, 1).getDay();
  const start = first.subtract({ days: lead });
  return Array.from({ length: 42 }, (_, i) => start.add({ days: i }));
}
