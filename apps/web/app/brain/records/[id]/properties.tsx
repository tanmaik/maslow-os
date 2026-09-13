"use client";

import type { Property } from "@maslow/brain";
import {
  CalendarClockIcon,
  CalendarIcon,
  GaugeIcon,
  HashIcon,
  ListIcon,
  TagIcon,
  TextIcon,
  ToggleLeftIcon,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DateField } from "@/components/date-field";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cell, percent } from "../../format";
import { save } from "./save";

// The mark on a line, by what the field holds, so a glance says what kind
// of thing the value is before it is read.
const MARKS: Record<string, LucideIcon> = {
  text: TextIcon,
  number: HashIcon,
  boolean: ToggleLeftIcon,
  date: CalendarIcon,
  datetime: CalendarClockIcon,
  enum: TagIcon,
  list: ListIcon,
};

// What a record holds beside its words, as a grid of lines: each field,
// how sure, when it happened. A line is clicked into to change it and kept
// as it is left.
export function Properties({
  id,
  fields,
  values,
  occurredAt,
  confidence,
  canEdit,
}: {
  id: string;
  fields: Property[];
  values: Record<string, unknown>;
  occurredAt: string | null;
  confidence: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
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
        const said = await save(id, { [field]: value });
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
  const whenShown = valueOf("occurred_at", occurredAt) as string | null;
  // How sure is kept as a part of one and shown as a percentage, and what
  // was just chosen is a percentage on its way.
  const sureChosen = chosen["confidence"];
  const sureShown =
    sureChosen === undefined
      ? confidence
      : sureChosen === ""
        ? null
        : Number(sureChosen) / 100;
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

  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] border-b pb-2 text-sm">
      {fields.map((f) => (
        <Line
          key={f.id}
          label={f.name}
          mark={MARKS[f.datatype] ?? TextIcon}
          shown={cell(valueOf(`p.${f.name}`, values[f.name], f), f)}
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
      ))}
      {undeclared.map((k) => (
        <Line
          key={k}
          label={k}
          mark={TextIcon}
          shown={cell(values[k])}
          editing={false}
        />
      ))}
      {(confidence !== null || canEdit) && (
        <Line
          label="how sure"
          mark={GaugeIcon}
          shown={percent(sureShown)}
          editing={editing === "how sure"}
          onOpen={canEdit ? () => open("how sure") : undefined}
          onClose={() => done("confidence")}
        >
          <Sure value={sureShown} onPick={setPending} />
        </Line>
      )}
      <Line
        label="when"
        mark={CalendarClockIcon}
        shown={whenShown ? <LocalTime at={whenShown} /> : ""}
        editing={editing === "when"}
        onOpen={canEdit ? () => open("when") : undefined}
        onClose={() => done("occurred_at")}
      >
        <DateField
          id="occurred_at"
          name="occurred_at"
          time
          defaultValue={whenShown ?? undefined}
          onChange={setPending}
        />
      </Line>
      {trouble && <p className="text-destructive col-span-2">{trouble}</p>}
    </dl>
  );
}

// One line: a quiet label and the value, or the control for it while it is
// being changed, with a way to leave it as it was.
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
  mark: LucideIcon;
  shown: React.ReactNode;
  editing: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`col-span-2 grid grid-cols-subgrid items-baseline rounded-lg py-0.5 ${
        editing ? "" : "hover:bg-muted/40"
      }`}
    >
      <dt className="text-muted-foreground flex min-w-0 items-center gap-2 px-2 leading-7">
        <Mark className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0 leading-7">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            {children}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-muted-foreground"
            >
              Done
            </Button>
          </div>
        ) : onOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpen}
            className="h-auto w-full justify-start px-2 py-0 font-normal whitespace-normal hover:bg-transparent"
          >
            {shown || <span className="text-muted-foreground">Empty</span>}
          </Button>
        ) : (
          <span className="block px-2">
            {shown || <span className="text-muted-foreground">Empty</span>}
          </span>
        )}
      </dd>
    </div>
  );
}

// How sure, from nothing to certain, read out beside the slider.
function Sure({
  value,
  onPick,
}: {
  value: number | null;
  onPick: (value: string) => void;
}) {
  const [now, setNow] = useState(Math.round((value ?? 1) * 100));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Slider
        aria-label="How sure"
        className="max-w-44"
        min={0}
        max={100}
        step={5}
        value={[now]}
        onValueChange={(v) => {
          const n = Array.isArray(v) ? (v[0] ?? 0) : v;
          setNow(n);
          onPick(String(n));
        }}
      />
      <span className="text-muted-foreground tabular-nums">{now}%</span>
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
        defaultValue={current}
        defaultOpen
        onValueChange={(v) => {
          const next = String(v ?? "");
          if (next === current) onClose();
          else onChange(next);
        }}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SelectTrigger className="w-full" aria-label={f.name}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {!f.required && <SelectItem value="">—</SelectItem>}
          {choices.map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
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
      autoFocus
      type={f.datatype === "number" ? "number" : "text"}
      step={f.datatype === "number" ? "any" : undefined}
      defaultValue={text}
      placeholder={f.datatype === "list" ? "one, two, three" : undefined}
      onBlur={(e) => onChange(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
