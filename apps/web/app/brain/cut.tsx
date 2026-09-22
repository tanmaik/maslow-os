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

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

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
    <ToggleGroup
      aria-label={label}
      variant="outline"
      spacing={0}
      value={[current]}
      onValueChange={([key]) => {
        const to = options.find((o) => o.key === key);
        if (to && to.key !== current) router.push(to.href);
      }}
      className={cn("shrink-0", className)}
    >
      {options.map((o) => {
        const Mark = marked ? MARKS[o.key] : undefined;
        return (
          <ToggleGroupItem
            key={o.key}
            value={o.key}
            aria-label={Mark ? o.label : undefined}
            title={Mark ? o.label : undefined}
          >
            {Mark ? <Mark aria-hidden /> : o.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
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
      <DropdownMenuTrigger
        aria-label="View"
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "shrink-0 max-sm:order-4 sm:hidden",
        )}
      >
        <RiMoreLine aria-hidden />
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
                    ? "text-foreground"
                    : "text-muted-foreground"
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
