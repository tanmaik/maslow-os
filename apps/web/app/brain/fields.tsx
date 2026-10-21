"use client";

import type { Property } from "@maslow/brain";

import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { Select, SelectItem } from "@/components/base/select/select";
import { DateField } from "@/components/date-field";

import { cell, FIELD } from "./format";

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
        if (choices) {
          return (
            <div key={p.id} className="flex flex-col gap-1.5">
              {labels && <Label isRequired={p.required}>{p.name}</Label>}
              <Select
                size="sm"
                name={id}
                aria-label={p.name}
                placeholder={p.required ? "Choose" : "None"}
                defaultSelectedKey={value === undefined ? null : String(value)}
                isRequired={p.required}
                triggerClassName={`w-full ${FIELD}`}
                popoverClassName="w-[var(--trigger-width)] max-w-none"
              >
                {choices.map(([v, label]) => (
                  <SelectItem key={v} id={v}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            </div>
          );
        }
        if (p.datatype === "date" || p.datatype === "datetime") {
          return (
            <div key={p.id} className="flex flex-col gap-1.5">
              {labels && <Label isRequired={p.required}>{p.name}</Label>}
              <DateField
                id={id}
                name={id}
                time={p.datatype === "datetime"}
                defaultValue={typeof value === "string" ? value : undefined}
                required={p.required}
              />
            </div>
          );
        }
        return (
          <Input
            size="small"
            key={p.id}
            name={id}
            label={labels ? p.name : undefined}
            aria-label={labels ? undefined : p.name}
            type={p.datatype === "number" ? "number" : "text"}
            inputMode={p.datatype === "number" ? "decimal" : undefined}
            defaultValue={cell(value, p)}
            placeholder={p.datatype === "list" ? "one, two, three" : undefined}
            isRequired={p.required}
          />
        );
      })}
    </>
  );
}
