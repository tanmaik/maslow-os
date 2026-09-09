"use client";

import type { BrainType, Datatype, Property } from "@maslow/brain";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { DateField } from "@/components/date-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { FieldInputs } from "./fields";

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
      <DialogTrigger render={<Button size="sm" />}>
        {type ? `New ${type.name}` : "New record"}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{type ? `New ${type.name}` : "New record"}</DialogTitle>
        </DialogHeader>
        <form action="/brain/records" method="post" className="grid gap-3">
          {type ? (
            <input type="hidden" name="type" value={type.name} />
          ) : (
            <div className="space-y-1">
              <Label htmlFor="kind">Type</Label>
              {fresh ? (
                <div className="flex gap-2">
                  <input type="hidden" name="new" value="1" />
                  <Input
                    id="kind"
                    name="type"
                    placeholder="What to call it"
                    required
                    autoFocus
                    autoComplete="off"
                    className="min-w-0 flex-1"
                  />
                  {types.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Pick a type instead"
                      onClick={() => setChosen(first)}
                    >
                      <XIcon />
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <NativeSelect
                    id="kind"
                    value={chosen}
                    onChange={(e) => setChosen(e.target.value)}
                    className="w-full"
                  >
                    {types.map((t) => (
                      <NativeSelectOption key={t.id} value={t.name}>
                        {t.name}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value="">
                      Something new…
                    </NativeSelectOption>
                  </NativeSelect>
                  <input type="hidden" name="type" value={chosen} />
                </>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required autoFocus={!fresh} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" name="body" rows={6} />
          </div>
          {!type && (
            <fieldset hidden={!fresh} disabled={!fresh} className="contents">
              {fields.map((f, i) => (
                <div key={f.key} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={f.label}
                      onChange={(e) => change(f.key, { label: e.target.value })}
                      placeholder="What to write down"
                      required
                      pattern="[^A-Za-z]*[A-Za-z].*"
                      title="Use at least one letter, a to z"
                      autoComplete="off"
                      className="min-w-0 flex-1"
                    />
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove"
                      onClick={() =>
                        setFields(fields.filter((g) => g.key !== f.key))
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <ToggleGroup
                    value={[f.datatype]}
                    onValueChange={(v) =>
                      v[0] && change(f.key, { datatype: v[0] as Datatype })
                    }
                    variant="outline"
                    size="sm"
                    spacing={0}
                    className="flex-wrap"
                  >
                    {KINDS.map(([d, said]) => (
                      <ToggleGroupItem key={d} value={d}>
                        {said}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {f.datatype === "enum" && (
                    <Input
                      name={`f${i}.options`}
                      value={f.options}
                      onChange={(e) =>
                        change(f.key, { options: e.target.value })
                      }
                      placeholder="The options, separated by commas"
                      required
                      pattern=".*\S.*"
                      title="Name at least one option"
                      autoComplete="off"
                    />
                  )}
                  <FieldInputs properties={[declared(f)]} labels={false} />
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={add}>
                  Add something to write down
                </Button>
              </div>
            </fieldset>
          )}
          {!fresh && <FieldInputs properties={picked?.properties ?? []} />}
          <div className="space-y-1">
            <Label htmlFor="occurred_at">When</Label>
            <DateField id="occurred_at" name="occurred_at" time />
          </div>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
