import { Forbidden, Invalid, NotFound } from "./errors.ts";
import {
  accepts,
  checkDefinition,
  holdKind,
  expected,
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
import type { Author, Property, Query, Verb } from "./types.ts";

// Changing the vocabulary after it is in use. A kind, a verb or a field is
// its owner's, and so are the records of it, so a change reaches the
// caller's own records and nobody else's: a rename carries them along, and
// a removal is refused while anything live still depends on it. A kind or
// a verb removed is hidden and kept, like a record, and restore brings it
// back.

const TABLE = { kind: "record_kinds", verb: "edge_verbs" } as const;

// Why a kind or verb named is not one of the caller's to use: a
// colleague's, shared in; the caller's own but removed; or not there.
export async function refuse(
  q: Query,
  what: "kind" | "verb",
  name: string,
): Promise<never> {
  const { rows } = await q.query<{ mine: boolean; removed: boolean }>(
    `select person_id = current_member() as mine, deleted_at is not null as removed
     from ${TABLE[what]} where name = $1
     order by person_id = current_member() desc limit 1`,
    [name],
  );
  const found = rows[0];
  if (found && !found.mine) {
    throw new Forbidden(
      `${name} is a colleague's ${what}; only they change it`,
    );
  }
  if (found?.removed) {
    throw new Invalid(`${what} ${name} is removed; restore it first`);
  }
  throw new NotFound(`no ${what} "${name}" in your vocabulary`);
}

export type Redefinition = { newName?: string; description?: string };

// Renames one of the caller's kinds or verbs, or rewrites what it means.
// Records and edges follow the name.
export async function redefine(
  q: Query,
  author: Author,
  what: "kind" | "verb",
  name: string,
  change: Redefinition,
): Promise<Verb> {
  for (const s of [change.newName, change.description]) {
    if (s !== undefined && (!s.trim() || !plain(s))) {
      throw new Invalid(`a ${what} needs a name and a description that print`);
    }
  }
  // The records and edges that follow a rename are logged as renamed by
  // whoever asked, not by whoever last wrote them.
  await q.query("select set_config('app.author', $1, true)", [author]);
  const { rows } = await q
    .query<VerbRow>(
      `update ${TABLE[what]}
       set name = coalesce($2, name), description = coalesce($3, description),
           author = $4
       where name = $1 and person_id = current_member() and deleted_at is null
         and (name, description) is distinct from
             (coalesce($2, name), coalesce($3, description))
       returning ${verbColumns}`,
      [name, change.newName ?? null, change.description ?? null, author],
    )
    .catch((err) => {
      if ((err as { code?: string }).code === "23505") {
        throw new Invalid(
          `a ${what} named "${change.newName}" exists; change its records instead`,
        );
      }
      throw err;
    });
  if (rows[0]) return toVerb(rows[0]);
  const { rows: same } = await q.query<VerbRow>(
    `select ${verbColumns} from ${TABLE[what]}
     where name = $1 and person_id = current_member() and deleted_at is null`,
    [name],
  );
  if (!same[0]) await refuse(q, what, name);
  return toVerb(same[0]!);
}

// Hides one of the caller's kinds or verbs, with a kind's fields. Refused
// while a live record is of the kind or an edge carries the verb; removed
// records go quiet with their kind and come back after it.
export async function undefine(
  q: Query,
  author: Author,
  what: "kind" | "verb",
  name: string,
): Promise<void> {
  const { rowCount: used } = await q.query(
    what === "kind"
      ? `select 1 from records
         where kind = $1 and person_id = current_member() and deleted_at is null
         limit 1`
      : `select 1 from edges
         where verb = $1 and person_id = current_member() limit 1`,
    [name],
  );
  if (used) {
    throw new Invalid(
      what === "kind"
        ? `records are still ${name}; change or remove them first`
        : `edges still ${name}; unlink them first`,
    );
  }
  const result = await q.query(
    `update ${TABLE[what]} set deleted_at = now(), author = $2
     where name = $1 and person_id = current_member() and deleted_at is null`,
    [name, author],
  );
  if (!result.rowCount) await refuse(q, what, name);
}

// Brings a removed kind or verb of the caller's back, as it was.
export async function restoreDefinition(
  q: Query,
  author: Author,
  what: "kind" | "verb",
  name: string,
): Promise<void> {
  const result = await q.query(
    `update ${TABLE[what]} set deleted_at = null, author = $2
     where name = $1 and person_id = current_member() and deleted_at is not null`,
    [name, author],
  );
  if (result.rowCount) return;
  const { rowCount } = await q.query(
    `select 1 from ${TABLE[what]} where name = $1 and person_id = current_member()`,
    [name],
  );
  if (rowCount) throw new Invalid(`${what} ${name} is not removed`);
  await refuse(q, what, name);
}

export type PropertyChange = Partial<PropertyDefinition> & { newName?: string };

// What the caller's records of a kind hold under a field, and whether each
// is live.
async function held(q: Query, kind: string, name: string) {
  const { rows } = await q.query<{ value: unknown; live: boolean }>(
    `select props -> $2::text as value, deleted_at is null as live
     from records where kind = $1 and person_id = current_member()`,
    [kind, name],
  );
  return rows;
}

// Changes a field's name, type, description, options or whether it is
// required, on one of the caller's kinds. The kind is held alone first, so
// writers checking against its fields wait; what records of the kind
// already hold must fit the field as it will be, and a rename carries
// their values to the new name, which no record may hold already.
export async function redefineProperty(
  q: Query,
  author: Author,
  kind: string,
  name: string,
  change: PropertyChange,
): Promise<Property> {
  if (!(await holdKind(q, kind, true))) {
    throw new NotFound(`no kind "${kind}" in your vocabulary`);
  }
  const { rows: found } = await q.query<PropertyRow>(
    `select ${propertyColumns} from kind_properties
     where kind = $1 and name = $2 and person_id = current_member()`,
    [kind, name],
  );
  if (!found[0]) throw new NotFound(`${kind} has no field "${name}"`);
  const was = toProperty(found[0]);
  const will: Property = {
    ...was,
    name: change.newName ?? was.name,
    type: change.type ?? was.type,
    description: change.description ?? was.description,
    required: change.required ?? was.required,
    options:
      change.options ??
      (change.type && change.type !== was.type ? null : was.options),
  };
  checkDefinition(kind, { ...will, options: will.options ?? undefined });

  const values = await held(q, kind, name);
  const misfits = values.filter(
    (r) => r.value !== null && !accepts(will, r.value),
  ).length;
  if (misfits) {
    throw new Invalid(
      `${name} of ${misfits} ${kind} record${misfits === 1 ? "" : "s"} is not ${expected(will)}, removed ones included; fix them first`,
    );
  }
  const missing = values.filter((r) => r.live && r.value === null).length;
  if (will.required && !was.required && missing) {
    throw new Invalid(
      `${missing} ${kind} record${missing === 1 ? " has" : "s have"} no ${name}; fill them in first`,
    );
  }
  if (will.name !== name) {
    const taken = (await held(q, kind, will.name)).filter(
      (r) => r.value !== null,
    ).length;
    if (taken) {
      throw new Invalid(
        `${taken} ${kind} record${taken === 1 ? " already has" : "s already have"} ${will.name}; choose another name`,
      );
    }
  }

  const { rows } = await q
    .query<PropertyRow>(
      `update kind_properties
       set name = $3, type = $4, description = $5, required = $6, options = $7,
           author = $8
       where kind = $1 and name = $2 and person_id = current_member()
       returning ${propertyColumns}`,
      [
        kind,
        name,
        will.name,
        will.type,
        will.description,
        will.required,
        will.options,
        author,
      ],
    )
    .catch((err) => {
      if ((err as { code?: string }).code === "23505") {
        throw new Invalid(`${kind} already has a field "${will.name}"`);
      }
      throw err;
    });
  if (will.name !== name) {
    await q.query(
      `update records
       set props = (props - $2::text) || jsonb_build_object($3::text, props -> $2::text),
           author = $4
       where kind = $1 and person_id = current_member() and props ? $2::text`,
      [kind, name, will.name, author],
    );
  }
  return toProperty(rows[0]!);
}

// Takes a field off one of the caller's kinds and its values out of every
// record of the kind. Returns how many records held one.
export async function removeProperty(
  q: Query,
  author: Author,
  kind: string,
  name: string,
): Promise<number> {
  if (!(await holdKind(q, kind, true))) {
    throw new NotFound(`no kind "${kind}" in your vocabulary`);
  }
  await q.query("select set_config('app.author', $1, true)", [author]);
  const gone = await q.query(
    `delete from kind_properties
     where kind = $1 and name = $2 and person_id = current_member()`,
    [kind, name],
  );
  if (!gone.rowCount) throw new NotFound(`${kind} has no field "${name}"`);
  const { rowCount } = await q.query(
    `update records set props = props - $2::text, author = $3
     where kind = $1 and person_id = current_member() and props ? $2::text`,
    [kind, name, author],
  );
  return rowCount ?? 0;
}
