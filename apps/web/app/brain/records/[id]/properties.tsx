"use client";

import type { Property } from "@maslow/brain";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCalendarLine,
  RiCalendarScheduleLine,
  RiHashtag,
  RiListCheck,
  RiPriceTag3Line,
  RiText,
  RiToggleLine,
} from "@remixicon/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ComponentType } from "react";

import { SettingsCard } from "@/components/application/settings/settings-rows";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { DateField } from "@/components/date-field";
import { LocalTime } from "@/components/local-time";
import { cx } from "@/utils/cx";

import { cell, FIELD } from "../../format";
import { save } from "./save";

type Mark = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// The mark on a line, by what the field holds, so a glance says what kind
// of thing the value is before it is read.
const MARKS: Record<string, Mark> = {
  text: RiText,
  number: RiHashtag,
  boolean: RiToggleLine,
  date: RiCalendarLine,
  datetime: RiCalendarScheduleLine,
  enum: RiPriceTag3Line,
  list: RiListCheck,
};

// The word for a choice left empty.
const NONE = "none";

// How many filled rows show before the rest fold, so the words are never
// far below the title.
const SHOWN = 5;

// What a record holds beside its words, as rows of a card: each field. The first
// few filled rows show; the rest, and
// every empty one, wait behind one row that says how many more there are.
// A row is clicked into to change it and kept as it is left.
export function Properties({
  id,
  fields,
  values,
  canEdit,
}: {
  id: string;
  fields: Property[];
  values: Record<string, unknown>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  // A day and a time are chosen in steps; what is chosen so far waits for
  // Done.
  const [pending, setPending] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  // What was chosen for each line, shown at once and kept until the page
  // has it; saves of a line go one after another, so none lands out of
  // order.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const saves = useRef<Record<string, Promise<void>>>({});
  const queued = useRef<Record<string, string>>({});
  const kept = useRef<Record<string, string>>({});
  const keep = (field: string, value: string) => {
    setEditing(null);
    setPending(null);
    queued.current[field] = value;
    setChosen((c) => ({ ...c, [field]: value }));
    saves.current[field] = (saves.current[field] ?? Promise.resolve()).then(
      async () => {
        const landed = await save(id, { [field]: value });
        const said = typeof landed === "number" ? null : landed.said;
        setTrouble(said);
        if (!said) {
          kept.current[field] = value;
          router.refresh();
        } else if (queued.current[field] === value) {
          // The failed value was the latest asked for: back to the last
          // that saved, or to what the page has when nothing did.
          const back = kept.current[field];
          queued.current[field] = back ?? "";
          setChosen((c) => {
            const { [field]: _, ...rest } = c;
            return back === undefined ? rest : { ...rest, [field]: back };
          });
        }
      },
    );
  };
  // A line's value as the person last chose it, else as the page has it.
  const valueOf = (field: string, fallback: unknown, f?: Property) => {
    const c = chosen[field];
    if (c === undefined) return fallback;
    if (c === "") return null;
    if (f?.datatype === "boolean") return c === "true";
    if (f?.datatype === "number") return Number(c);
    if (f?.datatype === "list")
      return c
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    return c;
  };
  const open = (line: string) => {
    setPending(null);
    setEditing(line);
  };
  const done = (field: string) => {
    if (pending !== null) void keep(field, pending);
    else {
      setEditing(null);
      setPending(null);
    }
  };
  const undeclared = Object.keys(values).filter(
    (k) => !fields.some((f) => f.name === k),
  );
  // A declared value as it reads. An instant is written in UTC and read
  // in the reader's own zone, so the browser is what says the hour.
  const shownOf = (v: unknown, f: Property) =>
    f.datatype === "datetime" && v !== undefined && v !== null && v !== "" ? (
      <LocalTime at={String(v)} fallback="" />
    ) : (
      cell(v, f)
    );

  // Every row the record could show, in the order it shows them.
  const rows: {
    key: string;
    shown: React.ReactNode;
    row: React.ReactNode;
  }[] = [];
  for (const f of fields) {
    const shown = shownOf(valueOf(`p.${f.name}`, values[f.name], f), f);
    rows.push({
      key: f.name,
      shown,
      row: (
        <Line
          key={f.id}
          label={f.name}
          mark={MARKS[f.datatype] ?? RiText}
          shown={shown}
          editing={editing === f.name}
          onOpen={canEdit ? () => open(f.name) : undefined}
          onClose={() => done(`p.${f.name}`)}
        >
          <FieldControl
            field={f}
            value={valueOf(`p.${f.name}`, values[f.name], f)}
            onChange={(v) => keep(`p.${f.name}`, v)}
            onPick={setPending}
            onClose={() => setEditing(null)}
          />
        </Line>
      ),
    });
  }
  for (const k of undeclared) {
    const shown = cell(values[k]);
    rows.push({
      key: k,
      shown,
      row: (
        <Line key={k} label={k} mark={RiText} shown={shown} editing={false} />
      ),
    });
  }
  // A reader who cannot fill an empty row is not shown one.
  const held = canEdit ? rows : rows.filter((r) => r.shown);
  if (!held.length) return null;

  // The first few filled rows, and the one being changed, stay in view;
  // the rest fold behind how many they are.
  let filled = 0;
  const stays = held.map((r) => {
    if (editing === r.key) return true;
    if (!r.shown) return false;
    filled += 1;
    return filled <= SHOWN;
  });
  const more = stays.filter((x) => !x).length;

  return (
    <SettingsCard>
      <dl className="contents">
        {held.map((r, i) => (unfolded || stays[i]) && r.row)}
      </dl>
      {more > 0 && (
        <Button
          variant="ghost"
          size="small"
          leadingIcon={unfolded ? RiArrowUpSLine : RiArrowDownSLine}
          onClick={() => setUnfolded((u) => !u)}
          className="my-1 mr-2.5 self-start"
        >
          {unfolded ? "Show less" : `${more} ${filled ? "more" : "fields"}`}
        </Button>
      )}
      {trouble && (
        <p className="py-2 pr-2.5 text-body-regular text-text-error-primary">
          {trouble}
        </p>
      )}
    </SettingsCard>
  );
}

// One row: a quiet label with its mark, and the value at the right, or the
// control for it while it is being changed, with a way to leave it as it
// was.
function Line({
  label,
  mark: Mark,
  shown,
  editing,
  onOpen,
  onClose,
  children,
}: {
  label: string;
  mark: Mark;
  shown: React.ReactNode;
  editing: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] w-full items-center justify-between gap-4 border-b border-separator-border py-2.5 pr-2.5 last:border-b-0">
      <dt className="flex min-w-0 shrink-0 items-center gap-2 text-body-regular text-text-primary">
        <Mark
          className="size-5 shrink-0 text-foreground-icon-secondary"
          aria-hidden
        />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="flex min-w-0 flex-1 justify-end">
        {editing ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {children}
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        ) : onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cx(
              "min-w-0 max-w-full cursor-pointer truncate rounded-lg px-2 py-1 text-right text-body-regular outline-none",
              "transition-colors duration-fast ease-plain hover:bg-background-secondary-hover active:bg-background-secondary-active focus-visible:ring-2 focus-visible:ring-border-focus-ring",
              shown ? "text-text-primary" : "text-text-tertiary",
            )}
          >
            {shown || "Empty"}
          </button>
        ) : (
          <span
            className={cx(
              "truncate px-2 py-1 text-right text-body-regular",
              shown ? "text-text-primary" : "text-text-tertiary",
            )}
          >
            {shown || "Empty"}
          </span>
        )}
      </dd>
    </div>
  );
}

// One field's control, by what it holds: a choice, yes or no, a day, a
// number, or words. A choice or words report when chosen or left; a day is
// picked in steps and reports each, for Done to keep.
function FieldControl({
  field: f,
  value,
  onChange,
  onPick,
  onClose,
}: {
  field: Property;
  value: unknown;
  onChange: (value: string) => void;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const text = cell(value, f);
  if (f.datatype === "enum" || f.datatype === "boolean") {
    const choices: [string, string][] =
      f.datatype === "enum"
        ? (f.options ?? []).map((o) => [o, o])
        : [
            ["true", "yes"],
            ["false", "no"],
          ];
    const current = value === undefined || value === null ? "" : String(value);
    return (
      <Select
        size="sm"
        aria-label={f.name}
        defaultSelectedKey={current || NONE}
        defaultOpen
        onSelectionChange={(k) => {
          const next = k === NONE ? "" : String(k ?? "");
          if (next === current) onClose();
          else onChange(next);
        }}
        triggerClassName={`min-w-40 ${FIELD}`}
      >
        {!f.required && <SelectItem id={NONE}>—</SelectItem>}
        {choices.map(([v, label]) => (
          <SelectItem key={v} id={v}>
            {label}
          </SelectItem>
        ))}
      </Select>
    );
  }
  if (f.datatype === "date" || f.datatype === "datetime") {
    return (
      <DateField
        id={`p.${f.name}`}
        name={`p.${f.name}`}
        time={f.datatype === "datetime"}
        defaultValue={typeof value === "string" ? value : undefined}
        onChange={onPick}
      />
    );
  }
  return (
    <Input
      aria-label={f.name}
      size="small"
      autoFocus
      type={f.datatype === "number" ? "number" : "text"}
      inputMode={f.datatype === "number" ? "decimal" : undefined}
      defaultValue={text}
      placeholder={f.datatype === "list" ? "one, two, three" : undefined}
      onBlur={(e) => onChange((e.target as HTMLInputElement).value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="min-w-40 flex-1"
    />
  );
}
