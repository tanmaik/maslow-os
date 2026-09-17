"use client";

import { RiAddLine } from "@remixicon/react";

import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { Select, SelectItem } from "@/components/base/select/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { FIELD, recordHref } from "../../format";
import { OtherRecord } from "./other-record";

// A new link from or to this record, under any verb, behind a dashed pill
// among the links it joins.
export function LinkForm({ id, type }: { id: string; type: string }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            size="small"
            leadingIcon={RiAddLine}
            className="h-8 rounded-full border-dashed pr-3 text-text-secondary shadow-none"
          />
        }
      >
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
          <div className="-mx-5 grid gap-4 overflow-y-auto px-5">
            <div className="flex flex-col gap-1.5">
              <Label>Reads as</Label>
              <Select
                size="sm"
                name="direction"
                aria-label="Reads as"
                defaultSelectedKey="out"
                triggerClassName={`w-full ${FIELD}`}
                popoverClassName="w-[var(--trigger-width)] max-w-none"
              >
                <SelectItem id="out">this {type} … the other</SelectItem>
                <SelectItem id="in">the other … this {type}</SelectItem>
              </Select>
            </div>
            <Input size="small" name="verb" label="Verb" isRequired />
            <div className="flex flex-col gap-1.5">
              <Label isRequired>The other record</Label>
              <OtherRecord not={id} name="other" />
            </div>
          </div>
          <DialogFooter>
            <Button size="small" type="submit" leadingIcon={RiAddLine}>
              Link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
