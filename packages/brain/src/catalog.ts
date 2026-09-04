import { Invalid } from "./errors.ts";
import { defineProperty, type PropertyDefinition } from "./properties.ts";
import {
  propertyColumns,
  toProperty,
  toVerb,
  verbColumns,
  type PropertyRow,
  type VerbRow,
} from "./rows.ts";
import type { Author, Kind, Query, Verb } from "./types.ts";

// The org's vocabulary: every kind a record can be, with the fields each
// declares, and every verb an edge can carry. The agent reads this before it
// writes, and reuses before it defines.
export async function catalog(
  q: Query,
): Promise<{ kinds: Kind[]; verbs: Verb[] }> {
  const kinds = await q.query<VerbRow>(
    `select ${verbColumns} from record_kinds order by name`,
  );
  const properties = await q.query<PropertyRow>(
    `select ${propertyColumns} from kind_properties order by kind, name`,
  );
  const verbs = await q.query<VerbRow>(
    `select ${verbColumns} from edge_verbs order by name`,
  );
  return {
    kinds: kinds.rows.map((k) => ({
      ...toVerb(k),
      properties: properties.rows
        .filter((p) => p.kind === k.name)
        .map(toProperty),
    })),
    verbs: verbs.rows.map(toVerb),
  };
}

export type Definition = { name: string; description: string };
export type KindDefinition = Definition & { properties?: PropertyDefinition[] };

async function define(
  q: Query,
  table: "record_kinds" | "edge_verbs",
  author: Author,
  { name, description }: Definition,
): Promise<Verb> {
  if (!name.trim()) throw new Invalid("a kind or verb needs a name");
  if (!description.trim()) {
    throw new Invalid(
      `"${name}" needs a description: one sentence saying what it is`,
    );
  }
  await q.query(
    `insert into ${table} (name, description, author) values ($1, $2, $3)
     on conflict (org_id, name) do nothing`,
    [name, description, author],
  );
  const { rows } = await q.query<VerbRow>(
    `select ${verbColumns} from ${table} where name = $1`,
    [name],
  );
  return toVerb(rows[0]!);
}

// Adds a kind to the vocabulary, with any fields it declares. Defining one
// that exists returns it unchanged; new fields on an existing kind are added.
export async function defineKind(
  q: Query,
  author: Author,
  definition: KindDefinition,
): Promise<Kind> {
  const kind = await define(q, "record_kinds", author, definition);
  const properties = [];
  for (const p of definition.properties ?? []) {
    properties.push(await defineProperty(q, author, kind.name, p));
  }
  return { ...kind, properties };
}

// Adds a verb to the vocabulary. Defining one that exists returns it unchanged.
export const defineVerb = (
  q: Query,
  author: Author,
  definition: Definition,
): Promise<Verb> => define(q, "edge_verbs", author, definition);
