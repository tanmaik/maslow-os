"use client";

import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import type { CalendarDate } from "@internationalized/date";

import { Button } from "@/components/base/buttons/button";

// The month shown, and a step back and forward.
export function CalendarMonthSwitcher({
  monthLabel,
  onPrevMonth,
  onNextMonth,
}: {
  month: CalendarDate;
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate?: (date: CalendarDate) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="small"
        iconOnly
        leadingIcon={RiArrowLeftSLine}
        aria-label="Previous month"
        onClick={onPrevMonth}
      />
      <span className="min-w-36 text-center text-body-medium text-text-primary">
        {monthLabel}
      </span>
      <Button
        variant="secondary"
        size="small"
        iconOnly
        leadingIcon={RiArrowRightSLine}
        aria-label="Next month"
        onClick={onNextMonth}
      />
    </div>
  );
}
