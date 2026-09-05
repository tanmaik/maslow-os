import { Invalid, NotFound } from "./errors.ts";
import { propertyColumns, toProperty, type PropertyRow } from "./rows.ts";
import type { Author, Property, PropertyType, Query } from "./types.ts";

export type PropertyDefinition = {
  name: string;
  type: PropertyType;
  description: string;
  required?: boolean;
  options?: string[];
};

// The fields a kind declares, by name. Empty when the kind accepts anything.
// The kind is the reader's own unless owner names whose it is.
export async function propertiesOf(
  q: Query,
  kind: string,
  owner?: string,
): Promise<Map<string, Property>> {
  const { rows } = await q.query<PropertyRow>(
    `select ${propertyColumns} from kind_properties
     where kind = $1 and person_id = coalesce($2, current_member())
     order by name`,
    [kind, owner ?? null],
  );
  return new Map(rows.map((r) => [r.name, toProperty(r)]));
}

// Adds a field to one of this person's kinds. Defining one that exists
// returns it unchanged.
export async function defineProperty(
  q: Query,
  author: Author,
  kind: string,
  def: PropertyDefinition,
): Promise<Property> {
  if (!/^[a-z][a-z0-9_]*$/.test(def.name)) {
    throw new Invalid(
      `"${def.name}" is not a field name: lowercase letters, digits and underscores`,
    );
  }
  if (!def.description.trim()) {
    throw new Invalid(`${kind}.${def.name} needs a description`);
  }
  if (!Object.hasOwn(sqlType, def.type)) {
    throw new Invalid(
      `"${String(def.type)}" is not a type; one of ${Object.keys(sqlType).join(", ")}`,
    );
  }
  if (def.type === "enum" && !def.options?.length) {
    throw new Invalid(`${kind}.${def.name} is an enum and needs options`);
  }
  if (def.type !== "enum" && def.options) {
    throw new Invalid(
      `${kind}.${def.name} is not an enum and takes no options`,
    );
  }
  try {
    await q.query(
      `insert into kind_properties
         (kind, name, type, description, required, options, author)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (org_id, person_id, kind, name) do nothing`,
      [
        kind,
        def.name,
        def.type,
        def.description,
        def.required ?? false,
        def.type === "enum" ? def.options : null,
        author,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      throw new NotFound(`"${kind}" is not a kind in your vocabulary`);
    }
    throw err;
  }
  const { rows } = await q.query<PropertyRow>(
    `select ${propertyColumns} from kind_properties
     where kind = $1 and name = $2 and person_id = current_member()`,
    [kind, def.name],
  );
  return toProperty(rows[0]!);
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
  switch (p.type) {
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
  p.type === "enum"
    ? `one of ${(p.options ?? []).join(", ")}`
    : p.type === "date"
      ? "a date like 2026-09-05"
      : p.type === "datetime"
        ? "an ISO date and time with a zone, like 2026-09-05T14:30:00Z"
        : p.type === "list"
          ? "a list of strings"
          : `a ${p.type}`;

// Checks props against a kind's form. A kind that declares nothing accepts
// anything; one that declares fields accepts only those, typed as declared.
export function check(
  kind: string,
  props: unknown,
  declared: Map<string, Property>,
): asserts props is Record<string, unknown> {
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    throw new Invalid(`${kind} props must be an object`);
  }
  if (declared.size === 0) return;
  const values = props as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      throw new Invalid(`${kind} has no field "${key}"; declare it first`);
    }
  }
  for (const p of declared.values()) {
    const v = values[p.name];
    if (v === undefined || v === null) {
      if (p.required) throw new Invalid(`${kind} needs "${p.name}"`);
      continue;
    }
    if (!accepts(p, v)) {
      throw new Invalid(`${kind}.${p.name} must be ${expected(p)}`);
    }
  }
}

// The SQL type a field's JSON text is compared as.
export const sqlType: Record<PropertyType, string> = {
  text: "text",
  enum: "text",
  list: "text",
  number: "numeric",
  boolean: "boolean",
  date: "date",
  datetime: "timestamptz",
};
