"use client";

import type { Property } from "@placeholder/brain";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DateField } from "@/components/date-field";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cell, percent } from "../../format";
import { save } from "./save";

// What a record holds beside its words, read as plain lines: each field,
// when it happened, how sure. A line is clicked into to change it and kept
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
    <dl className="space-y-2 text-sm">
      {fields.map((f) => (
        <Line
          key={f.id}
          label={f.name}
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
        <Line key={k} label={k} shown={cell(values[k])} editing={false} />
      ))}
      <Line
        label="when"
        shown={whenShown ? <LocalTime at={whenShown} /> : canEdit ? "add" : ""}
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
      {confidence !== null && (
        <p className="text-muted-foreground pt-1">{percent(confidence)} sure</p>
      )}
      {trouble && <p className="text-destructive">{trouble}</p>}
    </dl>
  );
}

// One line: a quiet label and the value, or the control for it while it is
// being changed, with a way to leave it as it was.
function Line({
  label,
  shown,
  editing,
  onOpen,
  onClose,
  children,
}: {
  label: string;
  shown: React.ReactNode;
  editing: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-muted-foreground w-20 shrink-0 truncate">{label}</dt>
      <dd className="min-w-0 flex-1">
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
            className="-mx-2 h-auto justify-start px-2 py-0.5 font-normal whitespace-normal"
          >
            {shown || <span className="text-muted-foreground">—</span>}
          </Button>
        ) : (
          <span>{shown || "—"}</span>
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
