import {
  Invalid,
  type Datatype,
  type PropertyDefinition,
  type Subject,
} from "@maslow/brain";
import { isUuid } from "@maslow/db";

// Whom a share names, as a form carries it: "everyone", "group:<id>" or
// "member:<id>".
export function subjectFrom(value: string): Subject | null {
  if (value === "everyone") return { who: "everyone" };
  const [who, id] = value.split(":");
  if ((who === "group" || who === "member") && id && isUuid(id)) {
    return { who, id };
  }
  return null;
}

// A field as this file needs to read it: what it is called and what it
// holds. A type's declared field and a field being declared both fit.
type Field = { name: string; datatype: Datatype };

// A form field's text as the value its declared field says, or undefined
// when empty so the write door can see a required field is missing.
export function fieldValue(p: Field, raw: string): unknown {
  const s = raw.trim();
  if (s === "") return undefined;
  switch (p.datatype) {
    case "number": {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Invalid(`${p.name} must be a number`);
      return n;
    }
    case "boolean":
      if (s === "true") return true;
      if (s === "false") return false;
      throw new Invalid(`${p.name} must be yes or no`);
    case "list":
      return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    default:
      return s;
  }
}

// The props a posted form carries: one input per declared field, named
// p.<field>.
export function propsFrom(
  form: FormData,
  properties: Field[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const p of properties) {
    const raw = form.get(`p.${p.name}`);
    if (typeof raw !== "string") continue;
    const v = fieldValue(p, raw);
    if (v !== undefined) props[p.name] = v;
  }
  return props;
}

// What every record has before its type declares anything.
const BUILT_IN = new Set(["title", "body", "modified"]);

// The fields a posted form declares for a type it makes up, numbered
// f0.name, f0.datatype, f0.options and so on; one left without a name is
// not a field, and two with one name, or one named for what every record
// already has, are refused.
export function definitionsFrom(form: FormData): PropertyDefinition[] {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const defs: PropertyDefinition[] = [];
  for (let i = 0; form.has(`f${i}.name`); i++) {
    const name = text(`f${i}.name`);
    if (!name) continue;
    if (defs.some((d) => d.name === name)) {
      throw new Invalid(`two of the fields would both be called "${name}"`);
    }
    if (BUILT_IN.has(name)) {
      throw new Invalid(`every record already has a ${name}`);
    }
    const options = text(`f${i}.options`)
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    defs.push({
      name,
      datatype: text(`f${i}.datatype`) as Datatype,
      options: options.length ? options : undefined,
    });
  }
  return defs;
}
