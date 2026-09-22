"use client";

import type { Datatype, Filter, Property } from "@maslow/brain";
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiFilter3Line,
} from "@remixicon/react";
import {
  addDays,
  addMonths,
  addWeeks,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { DateField } from "@/components/date-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CloseButton } from "@/components/ui/close-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { Choose } from "../choose";
import { typeText } from "../format";
import { saidOutright } from "./kept";
import {
  COMPARISONS,
  comparisonWord,
  termParams,
  termsFrom,
  termText,
  WHEN,
  type Term,
} from "./query";

// Whose records a list holds where it can hold more than one person's.
const WHOSE = {
  all: "All",
  mine: "Mine",
  shared: "Shared with me",
} as const;

// A window of time asked for by name rather than by picking two days, read
// in the person's own zone because their week is theirs.
const PRESETS: [string, () => [Date, Date]][] = [
  ["Today", () => [startOfDay(new Date()), addDays(startOfDay(new Date()), 1)]],
  [
    "This week",
    () => [
      startOfWeek(new Date(), { weekStartsOn: 1 }),
      addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1),
    ],
  ],
  [
    "This month",
    () => [startOfMonth(new Date()), addMonths(startOfMonth(new Date()), 1)],
  ],
];

// One choice among a few, made from a menu that closes on the pick.
function Pick({
  name,
  said,
  options,
  onPick,
}: {
  name: string;
  said: string;
  options: { key: string; label: string }[];
  onPick: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={name}
        render={<Button variant="outline" />}
      >
        {said}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuGroup>
          {options.map((o) => (
            <DropdownMenuItem key={o.key} onClick={() => onPick(o.key)}>
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One way of cutting a list into runs, each a page of its own.
type Grouping = {
  current: string;
  options: { key: string; label: string; href: string }[];
};

// What the list is ordered by, in one menu: the field, which way, and,
// where the list is cut into runs, by what. The trigger says the field and
// shows the way with an arrow.
function SortMenu({
  sort,
  direction,
  properties,
  grouping,
  onSort,
  onDirection,
}: {
  sort: string;
  direction: "asc" | "desc";
  properties: Property[];
  grouping?: Grouping;
  onSort: (key: string) => void;
  onDirection: (direction: "asc" | "desc") => void;
}) {
  const router = useRouter();
  const Arrow = direction === "asc" ? RiArrowUpLine : RiArrowDownLine;
  const byTime = sort === WHEN;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sort"
        render={<Button variant="outline" />}
      >
        {byTime ? "Modified" : sort}
        <Arrow data-icon="inline-end" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={onSort}>
            {[
              { key: WHEN, label: "Modified" },
              ...properties
                .filter((p) => p.datatype !== "list")
                .map((p) => ({ key: p.name, label: typeText(p.name) })),
            ].map((o) => (
              <DropdownMenuRadioItem key={o.key} value={o.key} closeOnClick>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Order</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={direction}
            onValueChange={(to) => onDirection(to as "asc" | "desc")}
          >
            <DropdownMenuRadioItem value="desc" closeOnClick>
              {byTime ? "Newest first" : "Largest first"}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="asc" closeOnClick>
              {byTime ? "Oldest first" : "Smallest first"}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {grouping && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={grouping.current}
                onValueChange={(key) => {
                  const to = grouping.options.find((o) => o.key === key);
                  if (to) router.push(to.href);
                }}
              >
                {grouping.options.map((o) => (
                  <DropdownMenuRadioItem key={o.key} value={o.key} closeOnClick>
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One condition being written: which field, how it compares, and what has
// been typed so far.
type Draft = { property: string; op: Filter["op"]; values: string[] };

const kindOf = (property: string, properties: Property[]): Datatype | "when" =>
  property === WHEN
    ? "when"
    : (properties.find((p) => p.name === property)?.datatype ?? "text");

// What narrows the list, over every view of it: the conditions as chips, a
// way to add one, what the list is sorted by, and whose records it holds.
// All of it is in the address, so a narrowed view is a link. On a wide
// screen it lies along a row of its own under the search; on a phone one
// button opens the same controls as a sheet.
export function Filters(props: {
  properties: Property[];
  // The org's members by name, so one person's records can be asked for.
  people: { id: string; name: string }[];
  offerWhose: boolean;
  // Whether the view sorts itself. A table's own column headers say what
  // it is sorted by and turn it around, so the row does not say it again.
  sortsItself: boolean;
  // How a list is cut into runs, offered inside the sort menu.
  grouping?: Grouping;
}) {
  const params = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const many = termsFrom(params.getAll("f")).length;
  return (
    <>
      {/* The controls stand in the bar itself; the conditions, when there
          are any, lie on a row of their own under it, as chips. */}
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <Conditions {...props} part="controls" />
      </div>
      {many > 0 && (
        <div className="order-last hidden w-full flex-wrap items-center gap-2 sm:flex">
          <Conditions {...props} part="chips" />
        </div>
      )}
      <Button
        variant="outline"
        onClick={() => setSheet(true)}
        className="shrink-0 max-sm:order-2 sm:hidden"
      >
        <RiFilter3Line data-icon="inline-start" />
        {many > 0 ? `Filter (${many})` : "Filter"}
      </Button>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[75dvh] gap-3 overflow-y-auto rounded-t-lg p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
        >
          <div
            aria-hidden
            className="-mt-2 mx-auto h-1 w-9 shrink-0 rounded-full bg-muted-foreground/50"
          />
          <SheetHeader className="p-0">
            <SheetTitle>Filter</SheetTitle>
          </SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Conditions {...props} part="all" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Conditions({
  properties,
  people,
  offerWhose,
  sortsItself,
  grouping,
  part,
}: {
  properties: Property[];
  people: { id: string; name: string }[];
  offerWhose: boolean;
  sortsItself: boolean;
  grouping?: Grouping;
  // Which of it to draw: the controls, the chips, or all of it in a sheet.
  part: "controls" | "chips" | "all";
}) {
  const controls = part !== "chips";
  const chips = part !== "controls";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const terms = termsFrom(params.getAll("f"));
  const sort = params.get("sort") ?? WHEN;
  const direction = params.get("dir") === "asc" ? "asc" : "desc";
  const whose = params.get("whose") ?? "all";

  // The same view with something changed, always from its first page.
  const go = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    next.delete("cursor");
    change(next);
    saidOutright(next);
    router.push(`${pathname}?${next}`);
  };
  const setTerms = (list: Term[]) =>
    go((next) => {
      next.delete("f");
      for (const t of list) for (const v of termParams(t)) next.append("f", v);
    });
  // A field is asked about once: a second condition on it replaces the
  // first, so "status is open" and "status is done" cannot both stand.
  const put = (t: Term) =>
    setTerms([...terms.filter((x) => x.property !== t.property), t]);
  const between = (from: Date, to: Date) =>
    setTerms([
      ...terms.filter((x) => x.property !== WHEN),
      { property: WHEN, op: "gte", values: [from.toISOString()] },
      { property: WHEN, op: "lt", values: [to.toISOString()] },
    ]);

  const fields = [...properties.map((p) => p.name), WHEN];
  const kind = draft ? kindOf(draft.property, properties) : "text";
  const options = draft
    ? (properties.find((p) => p.name === draft.property)?.options ?? [])
    : [];
  const ready =
    !!draft && (draft.op === "unset" || draft.values.some((v) => v !== ""));
  const start = (property: string) =>
    setDraft({
      property,
      op: COMPARISONS[kindOf(property, properties)][0]!,
      values: [],
    });
  const shut = () => {
    setOpen(false);
    setDraft(null);
  };

  return (
    <>
      {controls && (
        <Popover
          open={open}
          onOpenChange={(to) => {
            setOpen(to);
            if (to) start(fields[0]!);
            else setDraft(null);
          }}
        >
          <PopoverTrigger render={<Button variant="outline" />}>
            <RiFilter3Line data-icon="inline-start" />
            Filter
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 gap-3 p-3">
            <Field>
              <FieldLabel>Field</FieldLabel>
              <Choose
                aria-label="Field"
                value={draft?.property ?? null}
                onValueChange={start}
                className="w-full"
                options={fields.map(
                  (name) =>
                    [
                      name,
                      name === WHEN ? "Modified" : typeText(name),
                    ] as const,
                )}
              />
            </Field>
            {draft && (
              <Field>
                <FieldLabel>Condition</FieldLabel>
                <Choose
                  aria-label="Condition"
                  value={draft.op}
                  onValueChange={(k) =>
                    setDraft({
                      ...draft,
                      op: k as Filter["op"],
                      values: [],
                    })
                  }
                  className="w-full"
                  options={COMPARISONS[kind].map(
                    (op) => [op, comparisonWord(kind, op)] as const,
                  )}
                />
              </Field>
            )}
            {draft && draft.op !== "unset" && (
              <Field>
                <FieldLabel>Value</FieldLabel>
                {kind === "enum" ? (
                  <div className="flex flex-col gap-2">
                    {options.map((o) => (
                      <Label key={o} className="font-normal">
                        <Checkbox
                          checked={draft.values.includes(o)}
                          onCheckedChange={(on) =>
                            setDraft({
                              ...draft,
                              values: on
                                ? [...draft.values, o]
                                : draft.values.filter((v) => v !== o),
                            })
                          }
                        />
                        {o}
                      </Label>
                    ))}
                  </div>
                ) : kind === "boolean" ? (
                  <Choose
                    aria-label="Value"
                    value={draft.values[0] ?? null}
                    onValueChange={(k) => setDraft({ ...draft, values: [k] })}
                    className="w-full"
                    options={[
                      ["true", "yes"],
                      ["false", "no"],
                    ]}
                  />
                ) : kind === "date" ||
                  kind === "datetime" ||
                  kind === "when" ? (
                  <DateField
                    id="narrow-day"
                    name="narrow-day"
                    time={kind !== "date"}
                    onChange={(v) => setDraft({ ...draft, values: [v] })}
                  />
                ) : (
                  <Input
                    aria-label="Value"
                    type={kind === "number" ? "number" : "text"}
                    value={draft.values[0] ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, values: [e.target.value] })
                    }
                    placeholder={kind === "number" ? "0" : "a word or two"}
                  />
                )}
              </Field>
            )}
            {draft?.property === WHEN && (
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(([name, range]) => (
                  <Button
                    key={name}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const [from, to] = range();
                      shut();
                      between(from, to);
                    }}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            )}
            <Button
              size="sm"
              disabled={!ready}
              onClick={() => {
                if (!draft) return;
                shut();
                put({ ...draft, values: draft.values.filter((v) => v !== "") });
              }}
            >
              Apply
            </Button>
          </PopoverContent>
        </Popover>
      )}

      {chips &&
        terms.map((t) => (
          <Badge
            key={`${t.property}:${t.op}`}
            variant="secondary"
            className="h-6 gap-0.5 pr-0.5 pl-2"
          >
            {termText(t, properties)}
            <CloseButton
              size="icon-xs"
              className="size-5"
              aria-label={`Remove filter on ${t.property}`}
              title={`Remove filter on ${t.property}`}
              onClick={() =>
                setTerms(
                  terms.filter(
                    (x) => !(x.property === t.property && x.op === t.op),
                  ),
                )
              }
            />
          </Badge>
        ))}

      {controls && offerWhose && (
        <Pick
          name="Whose records"
          said={
            WHOSE[whose as keyof typeof WHOSE] ??
            people.find((m) => m.id === whose)?.name ??
            "Someone's"
          }
          options={[
            ...(Object.keys(WHOSE) as (keyof typeof WHOSE)[]).map((k) => ({
              key: k,
              label: WHOSE[k],
            })),
            ...people.map((m) => ({ key: m.id, label: m.name })),
          ]}
          onPick={(key) =>
            go((next) =>
              key === "all" ? next.delete("whose") : next.set("whose", key),
            )
          }
        />
      )}

      {controls && !sortsItself && (
        <SortMenu
          sort={sort}
          direction={direction}
          properties={properties}
          grouping={grouping}
          onSort={(key) =>
            go((next) =>
              key === WHEN ? next.delete("sort") : next.set("sort", key),
            )
          }
          onDirection={(to) =>
            go((next) =>
              to === "desc" ? next.delete("dir") : next.set("dir", "asc"),
            )
          }
        />
      )}
      {chips && terms.length > 0 && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            go((next) => {
              next.delete("f");
              next.delete("sort");
              next.delete("dir");
            })
          }
        >
          Clear
        </Button>
      )}
    </>
  );
}
