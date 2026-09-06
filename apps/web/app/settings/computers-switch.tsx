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

// The owner's switch for the whole org. Turning them off stops everyone's
// machine, so it asks first, as powering one off does.
export function ComputersSwitch({
  on,
  members,
}: {
  on: boolean;
  members: number;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <form
        id="computers-switch"
        action="/settings/computers"
        method="post"
        className={on ? "hidden" : undefined}
      >
        <input type="hidden" name="on" value={on ? "no" : "yes"} />
        {!on && (
          <Button type="submit" data-computers="off">
            Turn computers on
          </Button>
        )}
      </form>
      {on && (
        <Button
          type="button"
          variant="outline"
          data-computers="on"
          onClick={() => setAsking(true)}
        >
          Turn computers off…
        </Button>
      )}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn computers off for the whole org?</DialogTitle>
            <DialogDescription>
              Every machine in the org stops within the hour, and every terminal
              and everything running in it stops with it. Nobody gets a new one
              while it is off. Everyone&apos;s disk and files are kept, and
              still cost, until you remove and purge the member. This is{" "}
              {members === 1 ? "1 person" : `${members} people`}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Leave them on
            </Button>
            <Button variant="destructive" type="submit" form="computers-switch">
              Turn them off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
