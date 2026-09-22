"use client";

import { RiAddLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { Choose } from "../../choose";
import { Required } from "../../fields";
import { recordHref } from "../../format";
import { OtherRecord } from "./other-record";

// A new link from or to this record, under any verb, behind a dashed
// button among the links it joins.
export function LinkForm({
  id,
  type,
  back,
}: {
  id: string;
  type: string;
  // Where the page comes back to once the link is made.
  back: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="self-start border-dashed text-muted-foreground"
          />
        }
      >
        <RiAddLine data-icon="inline-start" />
        Link
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to another record</DialogTitle>
          <DialogDescription>
            A link is a sentence: this record, a verb, another record.
          </DialogDescription>
        </DialogHeader>
        <form
          action={`${recordHref(id)}/link`}
          method="post"
          className="contents"
        >
          <input type="hidden" name="back" value={back} />
          <div className="-mx-4 grid gap-4 overflow-y-auto px-4 py-px">
            <Field>
              <FieldLabel>Direction</FieldLabel>
              <Choose
                name="direction"
                aria-label="Direction"
                defaultValue="out"
                className="w-full"
                options={[
                  ["out", `this ${type} … the other`],
                  ["in", `the other … this ${type}`],
                ]}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="link-verb">
                Verb
                <Required />
              </FieldLabel>
              <Input id="link-verb" name="verb" required />
            </Field>
            <Field>
              <FieldLabel>
                Record
                <Required />
              </FieldLabel>
              <OtherRecord not={id} name="other" />
            </Field>
          </div>
          <DialogFooter>
            <Button size="sm" type="submit">
              <RiAddLine data-icon="inline-start" />
              Link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
