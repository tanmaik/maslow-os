"use client";

import {
  RiCalendarLine,
  RiKanbanView,
  RiListUnordered,
  RiMoreLine,
  RiTableLine,
} from "@remixicon/react";
import type { ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { buttonStyles } from "@/components/base/buttons/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cx } from "@/utils/cx";

// A way of cutting the list: its name and where it goes.
type Option = { key: string; label: string; href: string };

// The mark each way of looking at the list wears where the row is marks
// alone.
const MARKS: Record<
  string,
  ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>
> = {
  list: RiListUnordered,
  table: RiTableLine,
  board: RiKanbanView,
  calendar: RiCalendarLine,
};

// One way of cutting the list among a few, each a page of its own: picking
// one goes there, and every one is fetched ahead so the pick is instant.
export function Cut({
  label,
  options,
  current,
  marked = false,
  className,
}: {
  label: string;
  options: Option[];
  current: string;
  // Whether the segments are marks, each named for the pointer and the
  // screen reader, rather than words.
  marked?: boolean;
  className?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    for (const o of options) router.prefetch(o.href);
  }, [options, router]);
  return (
    <SegmentedControl
      aria-label={label}
      selectedKeys={[current]}
      onSelectionChange={(keys) => {
        const key = [...keys][0];
        const to = options.find((o) => o.key === key);
        if (to && to.key !== current) router.push(to.href);
      }}
      className={cx("shrink-0", className)}
    >
      {options.map((o) => {
        const Mark = marked ? MARKS[o.key] : undefined;
        return (
          <SegmentedControlItem
            key={o.key}
            id={o.key}
            aria-label={Mark ? o.label : undefined}
            className={Mark ? "px-2" : undefined}
          >
            {Mark ? <Mark className="size-4" aria-hidden /> : o.label}
          </SegmentedControlItem>
        );
      })}
    </SegmentedControl>
  );
}

// The same cuts on a phone, where a row of segments has no width to stand
// in: one control at the end of the bar, and every way of looking at the
// list under it, as a sheet.
export function Ways({
  cuts,
}: {
  cuts: {
    label: string;
    current: string;
    options: Option[];
  }[];
}) {
  const router = useRouter();
  useEffect(() => {
    for (const c of cuts) for (const o of c.options) router.prefetch(o.href);
  }, [cuts, router]);
  return (
    <DropdownMenu>
      {/* A plain button, not BoardUI's: the trigger has to take the
          menu's own props, and a react-aria button swallows them. */}
      <DropdownMenuTrigger
        aria-label="View"
        className={cx(
          buttonStyles.base,
          buttonStyles.size.small,
          buttonStyles.variant.secondary,
          "shrink-0 px-2 max-sm:order-4 sm:hidden",
        )}
      >
        <RiMoreLine aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {cuts.map((c, i) => (
          <DropdownMenuGroup key={c.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{c.label}</DropdownMenuLabel>
            {c.options.map((o) => (
              <DropdownMenuItem
                key={o.key}
                onClick={() => router.push(o.href)}
                aria-current={o.key === c.current ? "true" : undefined}
                className={
                  o.key === c.current
                    ? "text-text-primary"
                    : "text-text-secondary"
                }
              >
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
