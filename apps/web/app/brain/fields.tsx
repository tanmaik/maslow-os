"use client";

import type { Property } from "@maslow/brain";

import { DateField } from "@/components/date-field";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { Choose } from "./choose";
import { cell } from "./format";

// The star on the name of a field that must be filled.
export function Required() {
  return (
    <span aria-hidden className="-ml-1.5 text-destructive">
      *
    </span>
  );
}

// A field's name over its input, starred when the record needs it.
function Name({ p, htmlFor }: { p: Property; htmlFor?: string }) {
  return (
    <FieldLabel htmlFor={htmlFor}>
      {p.name}
      {p.required && <Required />}
    </FieldLabel>
  );
}

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
            ? (p.options ?? []).map((o) => [o, o] as const)
            : p.datatype === "boolean"
              ? ([
                  ["true", "yes"],
                  ["false", "no"],
                ] as const)
              : null;
        if (choices) {
          return (
            <Field key={p.id}>
              {labels && <Name p={p} />}
              <Choose
                name={id}
                aria-label={p.name}
                placeholder={p.required ? "Choose" : "None"}
                defaultValue={value === undefined ? null : String(value)}
                required={p.required}
                options={choices}
                className="w-full"
              />
            </Field>
          );
        }
        if (p.datatype === "date" || p.datatype === "datetime") {
          return (
            <Field key={p.id}>
              {labels && <Name p={p} htmlFor={id} />}
              <DateField
                id={id}
                name={id}
                time={p.datatype === "datetime"}
                defaultValue={typeof value === "string" ? value : undefined}
                required={p.required}
              />
            </Field>
          );
        }
        return (
          <Field key={p.id}>
            {labels && <Name p={p} htmlFor={id} />}
            <Input
              id={id}
              name={id}
              aria-label={labels ? undefined : p.name}
              type={p.datatype === "number" ? "number" : "text"}
              inputMode={p.datatype === "number" ? "decimal" : undefined}
              defaultValue={cell(value, p)}
              placeholder={
                p.datatype === "list" ? "one, two, three" : undefined
              }
              required={p.required}
            />
          </Field>
        );
      })}
    </>
  );
}
