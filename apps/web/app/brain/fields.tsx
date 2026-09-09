import type { Property } from "@maslow/brain";

import { DateField } from "@/components/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cell } from "./format";

// One input per declared field, named p.<field>, holding what the record
// has: a select for a choice, a calendar for a day, a number for a number.
export function FieldInputs({
  properties,
  values = {},
  labels = true,
}: {
  properties: Property[];
  values?: Record<string, unknown>;
  labels?: boolean;
}) {
  return (
    <>
      {properties.map((p) => {
        const id = `p.${p.name}`;
        const value = values[p.name];
        const choices =
          p.datatype === "enum"
            ? (p.options ?? []).map((o) => [o, o])
            : p.datatype === "boolean"
              ? [
                  ["true", "yes"],
                  ["false", "no"],
                ]
              : null;
        return (
          <div key={p.id} className="space-y-1">
            {labels && (
              <Label htmlFor={id} className="inline-flex items-center gap-1.5">
                {p.name}
                {p.required && <span className="text-muted-foreground">*</span>}
              </Label>
            )}
            {choices ? (
              <Select
                name={id}
                defaultValue={value === undefined ? null : String(value)}
                required={p.required}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue placeholder={p.required ? "Choose" : "None"} />
                </SelectTrigger>
                <SelectContent>
                  {!p.required && <SelectItem value="">None</SelectItem>}
                  {choices.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : p.datatype === "date" || p.datatype === "datetime" ? (
              <DateField
                id={id}
                name={id}
                time={p.datatype === "datetime"}
                defaultValue={typeof value === "string" ? value : undefined}
                required={p.required}
              />
            ) : p.datatype === "number" ? (
              <Input
                id={id}
                name={id}
                type="number"
                step="any"
                defaultValue={cell(value, p)}
                required={p.required}
              />
            ) : (
              <Input
                id={id}
                name={id}
                defaultValue={cell(value, p)}
                placeholder={
                  p.datatype === "list" ? "one, two, three" : undefined
                }
                required={p.required}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
