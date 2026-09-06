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
import { dollars } from "@/lib/prices";

// More memory, now rather than at the next quiet moment. It asks first,
// because it doubles what the machine costs and everything running stops.
export function BiggerNow({
  at,
  from,
  to,
  was,
  now,
}: {
  at: string;
  from: string;
  to: string;
  was: number;
  now: number;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setAsking(true)}
      >
        Restart with more memory now
      </Button>
      <form
        id="bigger-now"
        action="/computer/bigger"
        method="post"
        className="hidden"
        data-bigger
      >
        <input type="hidden" name="path" value={at} />
      </form>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart with {to} of memory?</DialogTitle>
            <DialogDescription>
              It goes from {from} to {to}, which costs about {dollars(now)} a
              month while it runs, up from {dollars(was)}. It is a cold boot on
              the same disk: your files stay, and everything running now — every
              terminal, every server — stops. It takes a minute or two.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Leave it at {from}
            </Button>
            <Button type="submit" form="bigger-now">
              Restart with {to}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
