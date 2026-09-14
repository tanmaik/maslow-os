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

import { Chip } from "@/components/base/badges/chip";
import { Button, buttonStyles } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { Select, SelectItem } from "@/components/base/select/select";
import { DateField } from "@/components/date-field";
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
import { cx } from "@/utils/cx";

import { FIELD } from "../format";
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
  all: "Everyone's",
  mine: "Yours",
  shared: "Shared with you",
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

const TRIGGER = cx(
  buttonStyles.base,
  buttonStyles.size.small,
  buttonStyles.variant.secondary,
);

// One choice among a few, made from a menu that closes on the pick.
function Choose({
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
  const [open, setOpen] = useState(false);
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger aria-label={name} className={TRIGGER}>
        <span className={buttonStyles.label.small}>{said}</span>
      </DropdownTrigger>
      <DropdownPopover aria-label={name} placement="bottom end">
        <DropdownGroup>
          {options.map((o) => (
            <DropdownItem
              key={o.key}
              onSelect={() => {
                setOpen(false);
                onPick(o.key);
              }}
            >
              {o.label}
            </DropdownItem>
          ))}
        </DropdownGroup>
      </DropdownPopover>
    </Dropdown>
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
}) {
  const params = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const many = termsFrom(params.getAll("f")).length;
  return (
    <>
      {/* The row cancels the gap above it, so it sits against the search
          exactly where it did when it was a block of its own. */}
      <div className="hidden w-full flex-wrap items-center gap-2 sm:-mt-3 sm:flex">
        <Conditions {...props} />
      </div>
      <Button
        variant="secondary"
        size="small"
        leadingIcon={RiFilter3Line}
        onClick={() => setSheet(true)}
        className="shrink-0 max-sm:order-2 sm:hidden"
      >
        {many > 0 ? `Filter (${many})` : "Filter"}
      </Button>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[75dvh] gap-3 overflow-y-auto rounded-t-3xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
        >
          <div
            aria-hidden
            className="-mt-2 mx-auto h-1 w-9 shrink-0 rounded-full bg-foreground-icon-quaternary"
          />
          <SheetHeader className="p-0">
            <SheetTitle>Narrow the list</SheetTitle>
          </SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Conditions {...props} />
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
}: {
  properties: Property[];
  people: { id: string; name: string }[];
  offerWhose: boolean;
  sortsItself: boolean;
}) {
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
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
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
      <Popover
        open={open}
        onOpenChange={(to) => {
          setOpen(to);
          if (to) start(fields[0]!);
          else setDraft(null);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="secondary"
              size="small"
              leadingIcon={RiFilter3Line}
            >
              Filter
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80">
          <div className="flex flex-col gap-1.5">
            <Label>Narrow by</Label>
            <Select
              size="sm"
              aria-label="Narrow by"
              selectedKey={draft?.property ?? null}
              onSelectionChange={(k) => start(String(k))}
              triggerClassName={`w-full ${FIELD}`}
              popoverClassName="w-[var(--trigger-width)] max-w-none"
            >
              {fields.map((name) => (
                <SelectItem key={name} id={name}>
                  {name}
                </SelectItem>
              ))}
            </Select>
          </div>
          {draft && (
            <div className="flex flex-col gap-1.5">
              <Label>How</Label>
              <Select
                size="sm"
                aria-label="How"
                selectedKey={draft.op}
                onSelectionChange={(k) =>
                  setDraft({
                    ...draft,
                    op: String(k) as Filter["op"],
                    values: [],
                  })
                }
                triggerClassName={`w-full ${FIELD}`}
                popoverClassName="w-[var(--trigger-width)] max-w-none"
              >
                {COMPARISONS[kind].map((op) => (
                  <SelectItem key={op} id={op}>
                    {comparisonWord(kind, op)}
                  </SelectItem>
                ))}
              </Select>
            </div>
          )}
          {draft && draft.op !== "unset" && (
            <div className="flex flex-col gap-1.5">
              <Label>What</Label>
              {kind === "enum" ? (
                <div className="flex flex-col gap-2">
                  {options.map((o) => (
                    <Checkbox
                      size="sm"
                      key={o}
                      isSelected={draft.values.includes(o)}
                      onChange={(on) =>
                        setDraft({
                          ...draft,
                          values: on
                            ? [...draft.values, o]
                            : draft.values.filter((v) => v !== o),
                        })
                      }
                    >
                      {o}
                    </Checkbox>
                  ))}
                </div>
              ) : kind === "boolean" ? (
                <Select
                  size="sm"
                  aria-label="What"
                  selectedKey={draft.values[0] ?? null}
                  onSelectionChange={(k) =>
                    setDraft({ ...draft, values: [String(k)] })
                  }
                  triggerClassName={`w-full ${FIELD}`}
                  popoverClassName="w-[var(--trigger-width)] max-w-none"
                >
                  <SelectItem id="true">yes</SelectItem>
                  <SelectItem id="false">no</SelectItem>
                </Select>
              ) : kind === "date" || kind === "datetime" || kind === "when" ? (
                <DateField
                  id="narrow-day"
                  name="narrow-day"
                  time={kind !== "date"}
                  onChange={(v) => setDraft({ ...draft, values: [v] })}
                />
              ) : (
                <Input
                  size="small"
                  aria-label="What"
                  type={kind === "number" ? "number" : "text"}
                  value={draft.values[0] ?? ""}
                  onChange={(v) => setDraft({ ...draft, values: [v] })}
                  placeholder={kind === "number" ? "0" : "a word or two"}
                />
              )}
            </div>
          )}
          {draft?.property === WHEN && (
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(([name, range]) => (
                <Button
                  key={name}
                  variant="secondary"
                  size="small"
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
            size="small"
            disabled={!ready}
            onClick={() => {
              if (!draft) return;
              shut();
              put({ ...draft, values: draft.values.filter((v) => v !== "") });
            }}
          >
            Narrow the list
          </Button>
        </PopoverContent>
      </Popover>

      {terms.map((t) => (
        <Chip key={`${t.property}:${t.op}`} color="soft" className="gap-1 pr-1">
          {termText(t, properties)}
          <CloseButton
            size="sm"
            aria-label={`Stop narrowing by ${t.property}`}
            title={`Stop narrowing by ${t.property}`}
            onClick={() =>
              setTerms(
                terms.filter(
                  (x) => !(x.property === t.property && x.op === t.op),
                ),
              )
            }
          />
        </Chip>
      ))}

      <span className="flex-1" />

      {offerWhose && (
        <Choose
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

      {!sortsItself && (
        <>
          <Choose
            name="Sorted by"
            said={`Sorted by ${sort}`}
            options={[
              { key: WHEN, label: WHEN },
              ...properties
                .filter((p) => p.datatype !== "list")
                .map((p) => ({ key: p.name, label: p.name })),
            ]}
            onPick={(key) =>
              go((next) =>
                key === WHEN ? next.delete("sort") : next.set("sort", key),
              )
            }
          />
          <Button
            variant="secondary"
            size="small"
            iconOnly
            leadingIcon={direction === "asc" ? RiArrowUpLine : RiArrowDownLine}
            aria-label={
              direction === "asc" ? "Smallest first" : "Largest first, as now"
            }
            onClick={() =>
              go((next) =>
                direction === "asc"
                  ? next.delete("dir")
                  : next.set("dir", "asc"),
              )
            }
          />
        </>
      )}
      {(terms.length > 0 || params.get("sort") || params.get("dir")) && (
        <Button
          variant="secondary"
          size="small"
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
