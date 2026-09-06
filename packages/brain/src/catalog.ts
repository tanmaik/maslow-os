import { Invalid } from "./errors.ts";
import {
  defineProperty,
  plain,
  type PropertyDefinition,
} from "./properties.ts";
import {
  propertyColumns,
  toProperty,
  toVerb,
  verbColumns,
  type PropertyRow,
  type VerbRow,
} from "./rows.ts";
import type { Author, Kind, Property, Query, Verb, Via } from "./types.ts";

// How a kind reaches this brain, as the database says it: kind:everyone,
// kind:you, record:everyone or record:you; null for the person's own.
const via = (reach: string | null): Via | null =>
  reach
    ? {
        whole: reach.startsWith("kind:"),
        everyone: reach.endsWith(":everyone"),
      }
    : null;

// This person's vocabulary: every kind they defined, with the fields each
// declares, and every verb an edge can carry; with the kinds colleagues have
// shared into this brain, each saying whose it is and how it reached here.
// The agent reads this before it writes, and reuses before it defines.
export async function catalog(
  q: Query,
): Promise<{ kinds: Kind[]; verbs: Verb[] }> {
  const kinds = await q.query<VerbRow & { reach: string | null }>(
    `select ${verbColumns},
       case when person_id = current_member() then null
         else kind_reach(id) end as reach
     from record_kinds
     order by person_id <> current_member(), name`,
  );
  const properties = await q.query<PropertyRow>(
    `select ${propertyColumns} from kind_properties order by kind, name`,
  );
  const verbs = await q.query<VerbRow>(
    `select ${verbColumns} from edge_verbs order by name`,
  );
  const fields = new Map<string, Property[]>();
  for (const row of properties.rows) {
    const key = `${row.person_id}:${row.kind}`;
    const kind = fields.get(key) ?? [];
    kind.push(toProperty(row));
    fields.set(key, kind);
  }
  return {
    kinds: kinds.rows.map((k) => ({
      ...toVerb(k),
      properties: fields.get(`${k.person_id}:${k.name}`) ?? [],
      via: via(k.reach),
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
  if (!name.trim() || !plain(name) || !plain(description)) {
    throw new Invalid(
      "a kind or verb needs a name and a description that print",
    );
  }
  if (!description.trim()) {
    throw new Invalid(
      `"${name}" needs a description: one sentence saying what it is`,
    );
  }
  await q.query(
    `insert into ${table} (name, description, author) values ($1, $2, $3)
     on conflict (org_id, person_id, name) do nothing`,
    [name, description, author],
  );
  const { rows } = await q.query<VerbRow>(
    `select ${verbColumns} from ${table}
     where name = $1 and person_id = current_member()`,
    [name],
  );
  return toVerb(rows[0]!);
}

// Adds a kind to this person's vocabulary, with any fields it declares.
// Defining one they have returns it unchanged; new fields on an existing
// kind are added.
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
  return { ...kind, properties, via: null };
}

// Adds a verb to this person's vocabulary. Defining one they have returns
// it unchanged.
export const defineVerb = (
  q: Query,
  author: Author,
  definition: Definition,
): Promise<Verb> => define(q, "edge_verbs", author, definition);
