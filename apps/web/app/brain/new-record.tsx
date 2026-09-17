"use client";

import type { BrainType, Datatype, Property } from "@maslow/brain";
import { RiAddLine } from "@remixicon/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Divider } from "@/components/base/divider/divider";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Textarea } from "@/components/base/textarea/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { FieldInputs } from "./fields";
import { FIELD } from "./format";
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
            size="small"
            leadingIcon={RiAddLine}
            aria-label={type ? `New ${type.name}` : "New record"}
            className="max-sm:px-2"
          />
        }
      >
        <span className="max-sm:hidden">
          {type ? `New ${type.name}` : "New record"}
        </span>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{type ? `New ${type.name}` : "New record"}</DialogTitle>
        </DialogHeader>
        <form action="/brain/records" method="post" className="contents">
          <input type="hidden" name="back" value={back} />
          <div className="-mx-5 grid gap-4 overflow-y-auto px-5">
            {type ? (
              <input type="hidden" name="type" value={type.name} />
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                {fresh ? (
                  <div className="flex items-center gap-2">
                    <input type="hidden" name="new" value="1" />
                    <Input
                      size="small"
                      name="type"
                      aria-label="What to call the type"
                      placeholder="What to call it"
                      isRequired
                      autoFocus
                      autoComplete="off"
                      className="min-w-0 flex-1"
                    />
                    {types.length > 0 && (
                      <CloseButton
                        type="button"
                        size="sm"
                        aria-label="Pick a type instead"
                        onClick={() => setChosen(first)}
                      />
                    )}
                  </div>
                ) : (
                  <>
                    <Select
                      size="sm"
                      aria-label="Type"
                      selectedKey={chosen}
                      onSelectionChange={(k) =>
                        setChosen(k === NEW ? "" : String(k))
                      }
                      triggerClassName={`w-full ${FIELD}`}
                      popoverClassName="w-[var(--trigger-width)] max-w-none"
                    >
                      {types.map((t) => (
                        <SelectItem key={t.id} id={t.name}>
                          <TypeIcon type={t.name} />
                          {t.name}
                        </SelectItem>
                      ))}
                      <SelectItem id={NEW}>
                        <RiAddLine
                          className="size-4 shrink-0 text-foreground-icon-secondary"
                          aria-hidden
                        />
                        Something new…
                      </SelectItem>
                    </Select>
                    <input type="hidden" name="type" value={chosen} />
                  </>
                )}
              </div>
            )}
            <Input
              size="small"
              name="title"
              label="Title"
              isRequired
              autoFocus={!fresh}
            />
            <Textarea
              size="small"
              name="body"
              label="Body"
              rows={6}
              autoResize
              maxRows={10}
            />
            {!type && (
              <fieldset hidden={!fresh} disabled={!fresh} className="contents">
                {fields.map((f, i) => (
                  <div key={f.key} className="flex flex-col gap-3">
                    <Divider />
                    <div className="flex items-end gap-2">
                      <Input
                        size="small"
                        value={f.label}
                        onChange={(v) => change(f.key, { label: v })}
                        label="What to write down"
                        isRequired
                        pattern="[^A-Za-z]*[A-Za-z].*"
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
                      <CloseButton
                        type="button"
                        size="sm"
                        aria-label={`Drop ${f.label.trim() || "this field"}`}
                        className="mb-1.5"
                        onClick={() =>
                          setFields(fields.filter((g) => g.key !== f.key))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>What kind of thing</Label>
                      <SegmentedControl
                        aria-label="What kind of thing"
                        selectedKeys={[f.datatype]}
                        onSelectionChange={(keys) => {
                          const k = [...keys][0];
                          if (k) change(f.key, { datatype: k as Datatype });
                        }}
                        className="flex-wrap"
                      >
                        {KINDS.map(([d, said]) => (
                          <SegmentedControlItem key={d} id={d}>
                            {said}
                          </SegmentedControlItem>
                        ))}
                      </SegmentedControl>
                    </div>
                    {f.datatype === "enum" && (
                      <Input
                        size="small"
                        name={`f${i}.options`}
                        value={f.options}
                        onChange={(v) => change(f.key, { options: v })}
                        label="The options"
                        placeholder="The options, separated by commas"
                        isRequired
                        pattern=".*\S.*"
                        autoComplete="off"
                      />
                    )}
                    <div className="flex flex-col gap-1.5">
                      <Label>{f.label.trim() || "What this record says"}</Label>
                      <FieldInputs properties={[declared(f)]} labels={false} />
                    </div>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    leadingIcon={RiAddLine}
                    onClick={add}
                  >
                    Add something to write down
                  </Button>
                </div>
              </fieldset>
            )}
            {!fresh && <FieldInputs properties={picked?.properties ?? []} />}
          </div>
          <DialogFooter>
            <Button size="small" type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
