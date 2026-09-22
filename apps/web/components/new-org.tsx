"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// An org of the person's own, beside the ones they already belong to. It
// asks for a name, and lands them in it.
export function NewOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [making, setMaking] = useState(false);
  const [wrong, setWrong] = useState(false);
  // Opening or closing the dialog is a fresh form: nothing said about the
  // last attempt outlives it.
  const show = (open: boolean) => {
    setWrong(false);
    setMaking(false);
    onOpenChange(open);
  };
  return (
    <Dialog open={open} onOpenChange={show}>
      <DialogContent>
        <form
          action="/auth/new-org"
          method="post"
          target="_top"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            // A name of spaces is no name: said here, beside the field,
            // rather than on the page the form would land on.
            const name = new FormData(e.currentTarget).get("name");
            if (!String(name ?? "").trim()) {
              e.preventDefault();
              setWrong(true);
              return;
            }
            setMaking(true);
          }}
        >
          <DialogHeader>
            <DialogTitle>Make an org of your own</DialogTitle>
            <DialogDescription>
              It is yours: you pay for it, you invite whoever you like, and you
              can hand it over or delete it. You keep the orgs you are already
              in, and can switch between them from here.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={wrong || undefined}>
            <FieldLabel htmlFor="new-org-name">Name</FieldLabel>
            <Input
              id="new-org-name"
              name="name"
              required
              maxLength={80}
              placeholder="Blue Whale Bakery"
              aria-invalid={wrong || undefined}
              onChange={() => setWrong(false)}
            />
            {wrong && (
              <FieldError>
                The org needs a name of up to 80 characters.
              </FieldError>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => show(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={making}>
              {making ? "Making it…" : "Make it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
