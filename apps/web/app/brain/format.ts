import type { Property } from "@placeholder/brain";
import { format } from "date-fns";

// How the brain's values read on screen.

// An instant, as a person reads it: 4 Sep 2026, 16:41.
export const when = (d: Date | null) =>
  d ? format(d, "d MMM yyyy, HH:mm") : "";

// A calendar day stored as 2026-09-04, read as 4 Sep 2026.
export function day(s: string) {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : format(d, "d MMM yyyy");
}

export const percent = (c: number | null) =>
  c === null ? "" : `${Math.round(c * 100)}%`;

// A declared field's value as text. A missing value is an empty cell.
export function cell(v: unknown, p?: Property): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  if (p?.type === "date") return day(String(v));
  if (p?.type === "datetime") return when(new Date(String(v)));
  return String(v);
}

export const recordHref = (id: string) => `/brain/records/${id}`;

// Whether a path segment is shaped like an id at all, before the database
// is asked about it.
export const isId = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// The table view of one kind, or of everything.
export const kindHref = (kind?: string) =>
  kind ? `/brain?kind=${encodeURIComponent(kind)}` : "/brain";

// A kind's colour, the same everywhere it is drawn, from a hash of its name
// so adding a kind never recolours the others.
export function kindColor(kind: string): string {
  let h = 0;
  for (const c of kind) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `oklch(0.62 0.15 ${h})`;
}

// A verb as words: rests_on reads "rests on".
export const verbText = (verb: string) => verb.replace(/_/g, " ");

// Who an author string names, with people by their names. "seed" stays
// itself; a model or job says which.
export function authorText(author: string, people: Map<string, string>) {
  const [kind, ...rest] = author.split(":");
  const id = rest.join(":");
  if (kind === "person") return people.get(id) ?? "someone no longer here";
  if (kind === "model") return `the model, ${id}`;
  if (kind === "job") return `a job, ${id}`;
  if (kind === "seed") return "the example data";
  return author;
}

// Where a record came from, in words: the app it was read from and the
// app's own id for it, so the original can be found. A record typed in
// here has no original; example data says so.
export function sourceText(source: string, ref: string | null) {
  if (source === "person") return "typed in here";
  if (source === "seed") return `example data${ref ? ` (${ref})` : ""}`;
  return ref ? `read from ${source}, their id ${ref}` : `read from ${source}`;
}
