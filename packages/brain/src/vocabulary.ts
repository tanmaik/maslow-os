import { Forbidden, Invalid, NotFound } from "./errors.ts";
import {
  accepts,
  checkDefinition,
  holdType,
  expected,
  plain,
  type PropertyDefinition,
} from "./properties.ts";
import { propertyColumns, toProperty, type PropertyRow } from "./rows.ts";
import type { Property, Query } from "./types.ts";

// Changing the vocabulary after it is in use. A type or a field is its
// owner's, and so are the records of it, so a change reaches the caller's
// own records and nobody else's: a rename carries them along, and a
// removal is refused while anything live still depends on it. A type
// removed is hidden and kept, like a record, and restore brings it back.

// Why a type named is not one of the caller's to use: a colleague's,
// shared in; the caller's own but removed; or not there.
export async function refuse(q: Query, name: string): Promise<never> {
  const { rows } = await q.query<{ mine: boolean; removed: boolean }>(
    `select person_id = current_member() as mine, deleted_at is not null as removed
     from types where name = $1
     order by person_id = current_member() desc limit 1`,
    [name],
  );
  const found = rows[0];
  if (found && !found.mine) {
    throw new Forbidden(`${name} is a colleague's type; only they change it`);
  }
  if (found?.removed) {
    throw new Invalid(`type ${name} is removed; restore it first`);
  }
  throw new NotFound(`no type "${name}" in your vocabulary`);
}

// Renames one of the caller's types. Records follow the name.
export async function renameType(q: Query, name: string, newName: string) {
  if (!newName.trim() || !plain(newName)) {
    throw new Invalid("a type needs a name that prints");
  }
  const { rowCount } = await q
    .query(
      `update types set name = $2
       where name = $1 and person_id = current_member() and deleted_at is null
         and name <> $2`,
      [name, newName],
    )
    .catch((err) => {
      if ((err as { code?: string }).code === "23505") {
        throw new Invalid(
          `a type named "${newName}" exists; change its records instead`,
        );
      }
      throw err;
    });
  if (rowCount) return;
  if (name === newName && (await holdType(q, name, false))) return;
  await refuse(q, name);
}

// Renames a verb on every edge of the caller's that carries it, hidden ones
// too. Two records already joined under the new name keep that edge, brought
// back if it was hidden, and the old one goes quiet as a duplicate. Returns
// how many edges followed.
export async function renameVerb(
  q: Query,
  verb: string,
  newName: string,
): Promise<number> {
  if (!newName.trim() || !plain(newName)) {
    throw new Invalid("a verb needs a name that prints");
  }
  if (verb === newName) return 0;
  const SAME_PAIR = `n.from_id = o.from_id and n.to_id = o.to_id
    and n.verb = $2 and n.person_id = o.person_id`;
  await q.query(
    `update edges n set deleted_at = null from edges o
     where o.verb = $1 and o.person_id = current_member()
       and o.deleted_at is null and n.deleted_at is not null and ${SAME_PAIR}`,
    [verb, newName],
  );
  await q.query(
    `update edges o set deleted_at = now()
     where o.verb = $1 and o.person_id = current_member()
       and o.deleted_at is null
       and exists (select 1 from edges n where ${SAME_PAIR})`,
    [verb, newName],
  );
  const { rowCount } = await q.query(
    `update edges o set verb = $2
     where o.verb = $1 and o.person_id = current_member()
       and not exists (select 1 from edges n where ${SAME_PAIR})`,
    [verb, newName],
  );
  return rowCount ?? 0;
}

// Hides one of the caller's types, with its fields. Refused while a live
// record is of the type; removed ones go quiet with it and come back after
// it.
export async function removeType(q: Query, name: string): Promise<void> {
  // Held alone first, so a record being brought back under it waits, and
  // the count below is the truth when the row changes.
  if (!(await holdType(q, name, true))) await refuse(q, name);
  const { rowCount: used } = await q.query(
    `select 1 from records
     where type = $1 and person_id = current_member() and deleted_at is null
     limit 1`,
    [name],
  );
  if (used) {
    throw new Invalid(`records are still ${name}; change or remove them first`);
  }
  await q.query(
    `update types set deleted_at = now()
     where name = $1 and person_id = current_member() and deleted_at is null`,
    [name],
  );
}

// Brings a removed type of the caller's back, as it was.
export async function restoreType(q: Query, name: string): Promise<void> {
  const result = await q.query(
    `update types set deleted_at = null
     where name = $1 and person_id = current_member() and deleted_at is not null`,
    [name],
  );
  if (result.rowCount) return;
  const { rowCount } = await q.query(
    "select 1 from types where name = $1 and person_id = current_member()",
    [name],
  );
  if (rowCount) throw new Invalid(`type ${name} is not removed`);
  await refuse(q, name);
}

export type PropertyChange = Partial<PropertyDefinition> & { newName?: string };

// What the caller's records of a type hold under a field, and whether each
// is live.
async function held(q: Query, type: string, name: string) {
  const { rows } = await q.query<{ value: unknown; live: boolean }>(
    `select props -> $2::text as value, deleted_at is null as live
     from records where type = $1 and person_id = current_member()`,
    [type, name],
  );
  return rows;
}

// Changes a field's name, datatype, options or whether it is required, on
// one of the caller's types. The type is held alone first, so writers
// checking against its fields wait; what records of the type already hold
// must fit the field as it will be, and a rename carries their values to
// the new name, which no record may hold already.
export async function redefineProperty(
  q: Query,
  type: string,
  name: string,
  change: PropertyChange,
): Promise<Property> {
  if (!(await holdType(q, type, true))) {
    throw new NotFound(`no type "${type}" in your vocabulary`);
  }
  const { rows: found } = await q.query<PropertyRow>(
    `select ${propertyColumns} from type_properties
     where type = $1 and name = $2 and person_id = current_member()`,
    [type, name],
  );
  if (!found[0]) throw new NotFound(`${type} has no field "${name}"`);
  const was = toProperty(found[0]);
  const will: Property = {
    ...was,
    name: change.newName ?? was.name,
    datatype: change.datatype ?? was.datatype,
    required: change.required ?? was.required,
    options:
      change.options ??
      (change.datatype && change.datatype !== was.datatype
        ? null
        : was.options),
  };
  checkDefinition(type, { ...will, options: will.options ?? undefined });

  const values = await held(q, type, name);
  const misfits = values.filter(
    (r) => r.value !== null && !accepts(will, r.value),
  ).length;
  if (misfits) {
    throw new Invalid(
      `${name} of ${misfits} ${type} record${misfits === 1 ? "" : "s"} is not ${expected(will)}, removed ones included; fix them first`,
    );
  }
  const missing = values.filter((r) => r.live && r.value === null).length;
  if (will.required && !was.required && missing) {
    throw new Invalid(
      `${missing} ${type} record${missing === 1 ? " has" : "s have"} no ${name}; fill them in first`,
    );
  }
  if (will.name !== name) {
    const taken = (await held(q, type, will.name)).filter(
      (r) => r.value !== null,
    ).length;
    if (taken) {
      throw new Invalid(
        `${taken} ${type} record${taken === 1 ? " already has" : "s already have"} ${will.name}; choose another name`,
      );
    }
  }

  const { rows } = await q
    .query<PropertyRow>(
      `update type_properties
       set name = $3, datatype = $4, required = $5, options = $6
       where type = $1 and name = $2 and person_id = current_member()
       returning ${propertyColumns}`,
      [type, name, will.name, will.datatype, will.required, will.options],
    )
    .catch((err) => {
      if ((err as { code?: string }).code === "23505") {
        throw new Invalid(`${type} already has a field "${will.name}"`);
      }
      throw err;
    });
  if (will.name !== name) {
    await q.query(
      `update records
       set props = (props - $2::text) || jsonb_build_object($3::text, props -> $2::text)
       where type = $1 and person_id = current_member() and props ? $2::text`,
      [type, name, will.name],
    );
  }
  return toProperty(rows[0]!);
}

// Takes a field off one of the caller's types and its values out of every
// record of the type. Returns how many records held one.
export async function removeProperty(
  q: Query,
  type: string,
  name: string,
): Promise<number> {
  if (!(await holdType(q, type, true))) {
    throw new NotFound(`no type "${type}" in your vocabulary`);
  }
  const gone = await q.query(
    `delete from type_properties
     where type = $1 and name = $2 and person_id = current_member()`,
    [type, name],
  );
  if (!gone.rowCount) throw new NotFound(`${type} has no field "${name}"`);
  const { rowCount } = await q.query(
    `update records set props = props - $2::text
     where type = $1 and person_id = current_member() and props ? $2::text`,
    [type, name],
  );
  return rowCount ?? 0;
}
