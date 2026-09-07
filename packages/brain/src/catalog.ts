import { Invalid } from "./errors.ts";
import {
  defineProperty,
  plain,
  type PropertyDefinition,
} from "./properties.ts";
import {
  propertyColumns,
  toProperty,
  typeColumns,
  type PropertyRow,
  type TypeRow,
} from "./rows.ts";
import type { BrainType, Property, Query } from "./types.ts";

// This person's vocabulary: every type they defined, with the fields each
// declares, and the types colleagues have shared into this brain, each
// saying whose it is; then every verb an edge they can see carries.
export async function catalog(
  q: Query,
): Promise<{ types: BrainType[]; verbs: string[] }> {
  const types = await q.query<TypeRow & { own: boolean }>(
    `select ${typeColumns}, person_id = current_member() as own
     from types where deleted_at is null
     order by person_id <> current_member(), name`,
  );
  const properties = await q.query<PropertyRow>(
    `select ${propertyColumns} from type_properties order by type, name`,
  );
  const verbs = await q.query<{ verb: string }>(
    "select distinct verb from edges where deleted_at is null order by verb",
  );
  const fields = new Map<string, Property[]>();
  for (const row of properties.rows) {
    const key = `${row.person_id}:${row.type}`;
    const declared = fields.get(key) ?? [];
    declared.push(toProperty(row));
    fields.set(key, declared);
  }
  return {
    types: types.rows.map((t) => ({
      id: t.id,
      name: t.name,
      ownerId: t.person_id,
      properties: fields.get(`${t.person_id}:${t.name}`) ?? [],
      own: t.own,
    })),
    verbs: verbs.rows.map((v) => v.verb),
  };
}

export type TypeDefinition = {
  name: string;
  properties?: PropertyDefinition[];
};

// Adds a type to this person's vocabulary, with any fields it declares.
// Defining one they have returns it unchanged; new fields on an existing
// type are added, and named as added.
export async function defineType(
  q: Query,
  definition: TypeDefinition,
): Promise<BrainType & { created: boolean; added: string[] }> {
  const { name } = definition;
  if (!name.trim() || !plain(name)) {
    throw new Invalid("a type needs a name that prints");
  }
  const { rowCount } = await q.query(
    `insert into types (name) values ($1)
     on conflict (org_id, person_id, name) do nothing`,
    [name],
  );
  const { rows } = await q.query<TypeRow & { removed: boolean }>(
    `select ${typeColumns}, deleted_at is not null as removed from types
     where name = $1 and person_id = current_member()`,
    [name],
  );
  if (rows[0]!.removed) {
    throw new Invalid(
      `type ${name} is removed; restore it, or choose another name`,
    );
  }
  const properties = [];
  const added = [];
  for (const p of definition.properties ?? []) {
    const property = await defineProperty(q, name, p);
    properties.push(property);
    if (property.created) added.push(property.name);
  }
  return {
    id: rows[0]!.id,
    name,
    ownerId: rows[0]!.person_id,
    properties,
    own: true,
    created: (rowCount ?? 0) > 0,
    added,
  };
}
