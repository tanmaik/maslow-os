import { Invalid, NotFound } from "./errors.ts";
import { propertyColumns, toProperty, type PropertyRow } from "./rows.ts";
import type { Datatype, Property, Query } from "./types.ts";

export type PropertyDefinition = {
  name: string;
  datatype: Datatype;
  required?: boolean;
  options?: string[];
};

// Holds a type's row until commit: shared by a writer checking a value
// against the type's fields, alone by whoever changes those fields, so
// neither sees the other half-done. False when the type is not the
// person's own, which is the only type whose fields they change.
export async function holdType(
  q: Query,
  type: string,
  alone: boolean,
  owner?: string,
): Promise<boolean> {
  const { rowCount } = await q.query(
    `select 1 from types
     where name = $1 and person_id = coalesce($2, current_member())
       and deleted_at is null
     for ${alone ? "update" : "share"}`,
    [type, owner ?? null],
  );
  return (rowCount ?? 0) > 0;
}

// The fields a type declares, by name. Empty when the type accepts anything.
// The type is the reader's own unless owner names whose it is. A writer
// holds the type until it commits, so a field cannot be declared or
// redefined under a value that fits only what was declared before.
export async function propertiesOf(
  q: Query,
  type: string,
  owner?: string,
  hold = false,
): Promise<Map<string, Property>> {
  if (hold) await holdType(q, type, false, owner);
  const { rows } = await q.query<PropertyRow>(
    `select ${propertyColumns} from type_properties
     where type = $1 and person_id = coalesce($2, current_member())
     order by name`,
    [type, owner ?? null],
  );
  return new Map(rows.map((r) => [r.name, toProperty(r)]));
}

// Whether a name or an origin is one that prints: no control characters, so
// nothing written can forge a line in what an agent reads.
export const plain = (s: string) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s);

// Refuses a field that could not be one: a bad name, a datatype the brain
// does not have, an enum without options or options without an enum.
export function checkDefinition(type: string, def: PropertyDefinition) {
  if (!/^[a-z][a-z0-9_]*$/.test(def.name)) {
    throw new Invalid(
      `"${def.name}" is not a field name: lowercase letters, digits and underscores`,
    );
  }
  if (!Object.hasOwn(sqlType, def.datatype)) {
    throw new Invalid(
      `"${String(def.datatype)}" is not a datatype; one of ${Object.keys(sqlType).join(", ")}`,
    );
  }
  if (def.datatype === "enum" && !def.options?.length) {
    throw new Invalid(`${type}.${def.name} is an enum and needs options`);
  }
  if (def.options?.some((o) => !plain(o))) {
    throw new Invalid(`${type}.${def.name} has an option that does not print`);
  }
  if (def.datatype !== "enum" && def.options) {
    throw new Invalid(
      `${type}.${def.name} is not an enum and takes no options`,
    );
  }
}

// Adds a field to one of this person's types. Defining one that exists
// returns it unchanged.
export async function defineProperty(
  q: Query,
  type: string,
  def: PropertyDefinition,
): Promise<Property & { created: boolean }> {
  checkDefinition(type, def);
  if (!(await holdType(q, type, true))) {
    throw new NotFound(`"${type}" is not a type in your vocabulary`);
  }
  const { rowCount } = await q.query(
    `insert into type_properties (type, name, datatype, required, options)
     values ($1, $2, $3, $4, $5)
     on conflict (org_id, person_id, type, name) do nothing`,
    [
      type,
      def.name,
      def.datatype,
      def.required ?? false,
      def.datatype === "enum" ? def.options : null,
    ],
  );
  const { rows } = await q.query<PropertyRow>(
    `select ${propertyColumns} from type_properties
     where type = $1 and name = $2 and person_id = current_member()`,
    [type, def.name],
  );
  return { ...toProperty(rows[0]!), created: (rowCount ?? 0) > 0 };
}

// A real calendar day, written 2026-09-05.
const isDate = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// An ISO 8601 instant with a zone, like 2026-09-05T14:30:00Z.
const isDatetime = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  !Number.isNaN(Date.parse(v));

// Whether a value is what a field says it is.
export function accepts(p: Property, v: unknown): boolean {
  switch (p.datatype) {
    case "text":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return isDate(v);
    case "datetime":
      return isDatetime(v);
    case "enum":
      return typeof v === "string" && (p.options ?? []).includes(v);
    case "list":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
  }
}

export const expected = (p: Property) =>
  p.datatype === "enum"
    ? `one of ${(p.options ?? []).join(", ")}`
    : p.datatype === "date"
      ? "a date like 2026-09-05"
      : p.datatype === "datetime"
        ? "an ISO date and time with a zone, like 2026-09-05T14:30:00Z"
        : p.datatype === "list"
          ? "a list of strings"
          : `a ${p.datatype}`;

// Checks props against a type's form. A type that declares nothing accepts
// anything; one that declares fields accepts only those, typed as declared.
export function check(
  type: string,
  props: unknown,
  declared: Map<string, Property>,
): asserts props is Record<string, unknown> {
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    throw new Invalid(`${type} props must be an object`);
  }
  if (declared.size === 0) return;
  const values = props as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      throw new Invalid(`${type} has no field "${key}"; declare it first`);
    }
  }
  for (const p of declared.values()) {
    const v = values[p.name];
    if (v === undefined || v === null) {
      if (p.required) throw new Invalid(`${type} needs "${p.name}"`);
      continue;
    }
    if (!accepts(p, v)) {
      throw new Invalid(`${type}.${p.name} must be ${expected(p)}`);
    }
  }
}

// The SQL type a field's JSON text is compared as.
export const sqlType: Record<Datatype, string> = {
  text: "text",
  enum: "text",
  list: "text",
  number: "numeric",
  boolean: "boolean",
  date: "date",
  datetime: "timestamptz",
};
