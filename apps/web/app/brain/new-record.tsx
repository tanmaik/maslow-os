"use client";

import type { BrainType, Datatype, Property } from "@maslow/brain";
import { RiAddLine } from "@remixicon/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CloseButton } from "@/components/ui/close-button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { Choose } from "./choose";
import { FieldInputs, Required } from "./fields";
import { typeText } from "./format";
import { TypeIcon } from "./type-icon";

// What a field can hold, in the word a person picks it by.
const KINDS: [Datatype, string][] = [
  ["text", "Text"],
  ["number", "Number"],
  ["boolean", "Yes/no"],
  ["date", "Date"],
  ["datetime", "Date & time"],
  ["enum", "Choice"],
  ["list", "List"],
];

// The choice that turns the picker into the box for a new type's name.
const NEW = "+new";

// One thing to write down about a record of a type being made up.
type Field = {
  key: number;
  label: string;
  datatype: Datatype;
  options: string;
};

// The field name a label becomes: lowercase words joined by underscores.
// A label needs a letter a to z, or there is no name in it.
const nameOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "");

// The field as this record's form takes it, its value posted under the
// name the label becomes.
const declared = (f: Field): Property => ({
  id: String(f.key),
  type: "",
  name: nameOf(f.label),
  datatype: f.datatype,
  required: false,
  options: f.options
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  ownerId: "",
});

// A record written by hand. Of the type being looked at, with its fields;
// or, from the brain's front page, of any of the person's types or of a
// new one, made up along with its first record: each field is declared and
// filled in here. Picking "Something new…" turns the picker into the box
// for the name; what was typed for the new type's fields stays while
// another type is picked, hidden and out of the form until it is picked
// again.
export function NewRecord({
  types,
  type,
}: {
  types: BrainType[];
  type?: BrainType;
}) {
  // The type picked first: note when there is one, else the first there is.
  const first =
    types.find((t) => t.name === "note")?.name ?? types[0]?.name ?? "";
  // The view this was written from, which a refusal is said on.
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const back = `${pathname}${query ? `?${query}` : ""}`;
  const [chosen, setChosen] = useState(type?.name ?? first);
  const [fields, setFields] = useState<Field[]>([]);
  const [next, setNext] = useState(0);
  // The type being looked at is the type, whatever was picked before.
  const current = type?.name ?? chosen;
  const picked = types.find((t) => t.name === current);
  const fresh = current === "";
  const change = (key: number, patch: Partial<Field>) =>
    setFields(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const add = () => {
    setFields([
      ...fields,
      { key: next, label: "", datatype: "text", options: "" },
    ]);
    setNext(next + 1);
  };
  return (
    <Dialog>
      {/* On a phone the bar has room for the mark and no more; the words
          stay the button's name for anyone reading it aloud. */}
      <DialogTrigger
        render={
          <Button
            aria-label={type ? `New ${typeText(type.name)}` : "New record"}
            className="max-sm:px-2"
          />
        }
      >
        <RiAddLine data-icon="inline-start" />
        <span className="max-sm:hidden">
          {type ? `New ${typeText(type.name)}` : "New record"}
        </span>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {type ? `New ${typeText(type.name)}` : "New record"}
          </DialogTitle>
        </DialogHeader>
        <form action="/brain/records" method="post" className="contents">
          <input type="hidden" name="back" value={back} />
          <div className="-mx-4 grid gap-4 overflow-y-auto px-4 py-px">
            {type ? (
              <input type="hidden" name="type" value={type.name} />
            ) : (
              <Field>
                <FieldLabel>Type</FieldLabel>
                {fresh ? (
                  <div className="flex items-center gap-2">
                    <input type="hidden" name="new" value="1" />
                    <Input
                      name="type"
                      aria-label="Type name"
                      placeholder="Type name"
                      required
                      autoFocus
                      autoComplete="off"
                      className="min-w-0 flex-1"
                    />
                    {types.length > 0 && (
                      <CloseButton
                        aria-label="Choose an existing type"
                        onClick={() => setChosen(first)}
                      />
                    )}
                  </div>
                ) : (
                  <>
                    <Choose
                      aria-label="Type"
                      value={chosen}
                      onValueChange={(k) => setChosen(k === NEW ? "" : k)}
                      className="w-full"
                      options={[
                        ...types.map(
                          (t) =>
                            [
                              t.name,
                              <span
                                key={t.id}
                                className="flex items-center gap-2"
                              >
                                <TypeIcon type={t.name} />
                                {typeText(t.name)}
                              </span>,
                            ] as const,
                        ),
                        [
                          NEW,
                          <span key={NEW} className="flex items-center gap-2">
                            <RiAddLine
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            Something new…
                          </span>,
                        ] as const,
                      ]}
                    />
                    <input type="hidden" name="type" value={chosen} />
                  </>
                )}
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="new-title">
                Title
                <Required />
              </FieldLabel>
              <Input id="new-title" name="title" required autoFocus={!fresh} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-body">Body</FieldLabel>
              <Textarea
                id="new-body"
                name="body"
                className="max-h-60 min-h-32"
              />
            </Field>
            {!type && (
              <fieldset hidden={!fresh} disabled={!fresh} className="contents">
                {fields.map((f, i) => (
                  <div key={f.key} className="flex flex-col gap-3">
                    <Separator />
                    <div className="flex items-end gap-2">
                      <Field className="min-w-0 flex-1">
                        <FieldLabel htmlFor={`f${f.key}-name`}>
                          Field name
                          <Required />
                        </FieldLabel>
                        <Input
                          id={`f${f.key}-name`}
                          value={f.label}
                          onChange={(e) =>
                            change(f.key, { label: e.target.value })
                          }
                          required
                          pattern="[^A-Za-z]*[A-Za-z].*"
                          autoComplete="off"
                        />
                      </Field>
                      <input
                        type="hidden"
                        name={`f${i}.name`}
                        value={nameOf(f.label)}
                      />
                      <input
                        type="hidden"
                        name={`f${i}.datatype`}
                        value={f.datatype}
                      />
                      <CloseButton
                        size="icon"
                        aria-label={`Drop ${f.label.trim() || "this field"}`}
                        onClick={() =>
                          setFields(fields.filter((g) => g.key !== f.key))
                        }
                      />
                    </div>
                    <Field>
                      <FieldLabel>Field type</FieldLabel>
                      <ToggleGroup
                        aria-label="Field type"
                        variant="outline"
                        size="sm"
                        value={[f.datatype]}
                        onValueChange={([k]) => {
                          if (k) change(f.key, { datatype: k as Datatype });
                        }}
                        className="w-full flex-wrap"
                      >
                        {KINDS.map(([d, said]) => (
                          <ToggleGroupItem
                            key={d}
                            value={d}
                            className="aria-pressed:bg-foreground/10"
                          >
                            {said}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                    {f.datatype === "enum" && (
                      <Field>
                        <FieldLabel htmlFor={`f${f.key}-options`}>
                          Options
                          <Required />
                        </FieldLabel>
                        <Input
                          id={`f${f.key}-options`}
                          name={`f${i}.options`}
                          value={f.options}
                          onChange={(e) =>
                            change(f.key, { options: e.target.value })
                          }
                          placeholder="Options, separated by commas"
                          required
                          pattern=".*\S.*"
                          autoComplete="off"
                        />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel>
                        {f.label.trim() || "What this record says"}
                      </FieldLabel>
                      <FieldInputs properties={[declared(f)]} labels={false} />
                    </Field>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={add}
                  >
                    <RiAddLine data-icon="inline-start" />
                    Add something to write down
                  </Button>
                </div>
              </fieldset>
            )}
            {!fresh && <FieldInputs properties={picked?.properties ?? []} />}
          </div>
          <DialogFooter>
            <Button size="sm" type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
