import type { Datatype, Filter, Property } from "@maslow/brain";

import { cell, typeText } from "../format";

// The ways of looking at a list of records, and what the address, the
// filters and the sort mean. A view is a page of its own, so any of them
// can be linked and any of them can be come back to.

export const VIEWS = {
  list: "List",
  table: "Table",
  board: "Board",
  calendar: "Calendar",
} as const;
export type View = keyof typeof VIEWS;
export const isView = (v: string | undefined): v is View =>
  !!v && Object.hasOwn(VIEWS, v);

// When a record was last changed is not a declared field and never can
// be: every record already has one. This is the name it goes by in a sort,
// a filter and a calendar.
export const WHEN = "modified";

// One condition a person set, as the address carries it: a field or WHEN, a
// comparison, and what was typed. `in` gathers every value given for the
// same field into one condition.
export type Term = { property: string; op: Filter["op"]; values: string[] };

const OPS = new Set<Filter["op"]>([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "contains",
  "unset",
]);

// The comparisons a field of each kind offers, in the order they are shown.
export const COMPARISONS: Record<Datatype | "when", Filter["op"][]> = {
  text: ["contains", "eq", "unset"],
  number: ["eq", "gte", "lte", "unset"],
  boolean: ["eq", "unset"],
  date: ["gte", "lt", "unset"],
  datetime: ["gte", "lt", "unset"],
  enum: ["in", "unset"],
  list: ["contains", "unset"],
  when: ["gte", "lt"],
};

// What each comparison is called, in the words the kind of field asks for:
// a date runs from and before, a number is at least and at most.
const WORDS: Partial<
  Record<Datatype | "when", Partial<Record<Filter["op"], string>>>
> = {
  number: { gte: "at least", lte: "at most" },
  date: { gte: "on or after", lt: "before" },
  datetime: { gte: "on or after", lt: "before" },
  when: { gte: "on or after", lt: "before" },
};
const PLAIN: Record<Filter["op"], string> = {
  eq: "is",
  ne: "is not",
  lt: "before",
  lte: "up to",
  gt: "after",
  gte: "at least",
  in: "is any of",
  contains: "contains",
  unset: "is empty",
};

export const comparisonWord = (kind: Datatype | "when", op: Filter["op"]) =>
  WORDS[kind]?.[op] ?? PLAIN[op];

// One term as the address writes it: field, comparison and what was typed,
// cut on the first two colons so a value may hold one.
const TERM = /^([a-z][a-z0-9_]*):([a-z]+)(?::([\s\S]*))?$/;

// Every condition in an address, with the values for one field and one
// comparison gathered together.
export function termsFrom(given: string[]): Term[] {
  const terms: Term[] = [];
  for (const raw of given) {
    const m = TERM.exec(raw);
    if (!m) continue;
    const [, property, op, value] = m as unknown as [
      string,
      string,
      Filter["op"],
      string | undefined,
    ];
    if (!OPS.has(op)) continue;
    if (op !== "unset" && !value) continue;
    const same = terms.find((t) => t.property === property && t.op === op);
    if (same && op === "in") same.values.push(value!);
    else if (!same) terms.push({ property, op, values: value ? [value] : [] });
  }
  return terms;
}

// A term back as the address writes it: one string per value, since a set
// of values is a set of terms.
export const termParams = (t: Term) =>
  t.op === "unset"
    ? [`${t.property}:unset`]
    : t.values.map((v) => `${t.property}:${t.op}:${v}`);

// What was typed, as the field says it is: a number is a number, yes and no
// are booleans, and everything else stands as text the database casts.
function typed(kind: Datatype, raw: string): unknown {
  if (kind === "number") return Number(raw);
  if (kind === "boolean") return raw === "true";
  return raw;
}

// Whether what was typed could be what the field holds, so a half-typed
// filter narrows nothing rather than refusing the page.
function fits(kind: Datatype, raw: string): boolean {
  if (kind === "number") return raw.trim() !== "" && Number.isFinite(+raw);
  if (kind === "boolean") return raw === "true" || raw === "false";
  if (kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(raw);
  if (kind === "datetime") return !Number.isNaN(Date.parse(raw));
  return raw !== "";
}

export type Narrowed = {
  where: Filter[];
  since?: Date;
  until?: Date;
};

// The terms as the read door takes them: conditions on declared fields, and
// the window of time that WHEN stands for. A term naming a field this type
// does not declare is dropped, so an address from another type still opens.
export function narrowFrom(terms: Term[], properties: Property[]): Narrowed {
  const out: Narrowed = { where: [] };
  for (const t of terms) {
    if (t.property === WHEN) {
      const at = new Date(t.values[0] ?? "");
      if (Number.isNaN(at.getTime())) continue;
      if (t.op === "gte") out.since = at;
      if (t.op === "lt") out.until = at;
      continue;
    }
    const p = properties.find((f) => f.name === t.property);
    if (!p) continue;
    if (t.op === "unset") {
      out.where.push({ property: p.name, op: "unset" });
    } else if (t.op === "in") {
      const values = t.values.filter((v) => fits(p.datatype, v));
      if (values.length) {
        out.where.push({
          property: p.name,
          op: "in",
          value: values.map((v) => typed(p.datatype, v)),
        });
      }
    } else if (t.op === "contains") {
      if (t.values[0]) {
        out.where.push({
          property: p.name,
          op: "contains",
          value: t.values[0],
        });
      }
    } else if (fits(p.datatype, t.values[0] ?? "")) {
      out.where.push({
        property: p.name,
        op: t.op,
        value: typed(p.datatype, t.values[0]!),
      });
    }
  }
  return out;
}

// A term as a person reads it on its chip: the field, the comparison in the
// words that field asks for, and the values.
export function termText(t: Term, properties: Property[]): string {
  const p = properties.find((f) => f.name === t.property);
  const kind: Datatype | "when" =
    t.property === WHEN ? "when" : (p?.datatype ?? "text");
  const word = comparisonWord(kind, t.op);
  const name = t.property === WHEN ? "Modified" : typeText(t.property);
  if (t.op === "unset") return `${name} ${word}`;
  const said = t.values.map((v) =>
    p ? cell(typed(p.datatype, v), p) : cell(v, { datatype: "datetime" }),
  );
  return `${name} ${word} ${said.join(", ")}`;
}

// One record as every view draws it, with the whole of nothing in it: a
// title, the opening line, when it was written, whose it is where it is not
// the reader's, and the declared values a column or a card shows.
export type Row = {
  id: string;
  type: string;
  title: string;
  line: string;
  at: string | null;
  owner: string | null;
  props: Record<string, unknown>;
};
