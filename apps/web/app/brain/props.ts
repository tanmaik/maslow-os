import { Invalid, type Property } from "@placeholder/brain";
import { isValid, parseISO } from "date-fns";

// A form field's text as the value its declared field says, or undefined
// when empty so the write door can see a required field is missing.
function coerce(p: Property, raw: string): unknown {
  const s = raw.trim();
  if (s === "") return undefined;
  switch (p.type) {
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
  properties: Property[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const p of properties) {
    const raw = form.get(`p.${p.name}`);
    if (typeof raw !== "string") continue;
    const v = coerce(p, raw);
    if (v !== undefined) props[p.name] = v;
  }
  return props;
}

// A posted time as an instant, or null when the field was empty. A day that
// is not on the calendar is refused, not rolled into the next month.
export function instantFrom(raw: FormDataEntryValue | null): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = parseISO(s);
  if (!isValid(d)) throw new Invalid(`"${s}" is not a time`);
  return d;
}

// A posted confidence as a fraction, or null when the field was empty.
export function confidenceFrom(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!(n >= 0 && n <= 100)) {
    throw new Invalid("confidence is a percentage from 0 to 100");
  }
  return n / 100;
}
