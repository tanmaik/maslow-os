import type { BrainType, Property } from "@placeholder/brain";
import { format } from "date-fns";

// How the brain's values read on screen.

// An instant, as a person reads it: 4 Sep 2026, 16:41.
const when = (d: Date | null) => (d ? format(d, "d MMM yyyy, HH:mm") : "");

// A calendar day stored as 2026-09-04, read as 4 Sep 2026.
function day(s: string) {
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
  if (p?.datatype === "date") return day(String(v));
  if (p?.datatype === "datetime") return when(new Date(String(v)));
  return String(v);
}

export const recordHref = (id: string) => `/brain/records/${id}`;

// The table view of one type, or of everything. A type shared into this
// brain is named with its owner.
export const typeHref = (type?: string, owner?: string) => {
  if (!type) return "/brain";
  const q = new URLSearchParams({ type });
  if (owner) q.set("from", owner);
  return `/brain?${q}`;
};

type SharedGroup = {
  owner: string;
  ownerId: string;
  types: BrainType[];
};

// The types shared into this brain, grouped by who owns them, in the
// catalog's order.
export function sharedGroups(
  types: BrainType[],
  people: Map<string, string>,
): SharedGroup[] {
  const groups = new Map<string, SharedGroup>();
  for (const t of types) {
    if (t.own) continue;
    const group = groups.get(t.ownerId) ?? {
      owner: people.get(t.ownerId) ?? "someone no longer here",
      ownerId: t.ownerId,
      types: [],
    };
    group.types.push(t);
    groups.set(t.ownerId, group);
  }
  return [...groups.values()];
}

// A type's colour, the same everywhere it is drawn, from a hash of its name
// so adding a type never recolours the others.
export function typeColor(type: string): string {
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `oklch(0.62 0.15 ${h})`;
}

// A verb as words: rests_on reads "rests on".
export const verbText = (verb: string) => verb.replace(/_/g, " ");
