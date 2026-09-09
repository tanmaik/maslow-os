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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
          className="space-y-4"
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
          <div className="space-y-1.5">
            <Label htmlFor="new-org-name">Name</Label>
            <Input
              id="new-org-name"
              name="name"
              required
              maxLength={80}
              placeholder="Blue Whale Bakery"
              onChange={() => setWrong(false)}
            />
            {wrong && (
              <p className="text-destructive text-sm">
                The org needs a name of up to 80 characters.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => show(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={making}>
              {making ? "Making it…" : "Make it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
