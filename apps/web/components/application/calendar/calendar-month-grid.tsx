"use client";

import type { CalendarDate } from "@internationalized/date";
import Link from "next/link";
import { useEffect } from "react";

import { cx } from "@/utils/cx";

import { monthGrid } from "./calendar-data";

export type CalendarGridItem = {
  id: string;
  title: string;
  color?: string;
  href?: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Six weeks of days, each with the items that fall on it.
export function CalendarMonthGrid({
  month,
  highlightedDate,
  onHighlightEnd,
  items,
}: {
  month: CalendarDate;
  highlightedDate?: CalendarDate | null;
  onHighlightEnd?: () => void;
  items: (date: CalendarDate) => CalendarGridItem[];
}) {
  useEffect(() => {
    if (!highlightedDate) return;
    const t = setTimeout(() => onHighlightEnd?.(), 1500);
    return () => clearTimeout(t);
  }, [highlightedDate, onHighlightEnd]);
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((d) => (
        <div
          key={d}
          className="px-1 pb-1 text-caption-1-medium text-text-tertiary"
        >
          {d}
        </div>
      ))}
      {monthGrid(month).map((date) => {
        const inMonth = date.month === month.month;
        const lit = highlightedDate && date.compare(highlightedDate) === 0;
        return (
          <div
            key={date.toString()}
            className={cx(
              "flex min-h-24 flex-col gap-1 rounded-xl bg-background-primary-default p-1.5",
              !inMonth && "opacity-50",
              lit && "ring-2 ring-border-focus-ring",
            )}
          >
            <span className="text-caption-1-medium text-text-secondary">
              {date.day}
            </span>
            {items(date).map((item) => (
              <Link
                key={item.id}
                href={item.href ?? "#"}
                className="truncate rounded-md px-1.5 py-0.5 text-caption-1-medium text-text-primary hover:bg-background-secondary-hover"
                style={
                  item.color
                    ? { borderLeft: `3px solid ${item.color}` }
                    : undefined
                }
              >
                {item.title}
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}
