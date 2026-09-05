"use client";

import { Settings2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// What can be done to the computer as a whole: back the home up now, or
// reset the system around it. A reset asks first, and says what stays.
export function ComputerActions({ at }: { at: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" aria-label="Computer" />}
        >
          <Settings2 className="size-4" />
          Computer
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<button type="submit" form="backup-now" />}>
            Back up now
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setAsking(true)}
          >
            Reset the system…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form
        id="backup-now"
        action="/computer/backup-now"
        method="post"
        className="hidden"
        data-backup-now
      >
        <input type="hidden" name="path" value={at} />
      </form>
      <form
        id="reset-system"
        action="/computer/reset"
        method="post"
        className="hidden"
        data-reset
      >
        <input type="hidden" name="path" value={at} />
      </form>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the system?</DialogTitle>
            <DialogDescription>
              Kept: your home folder, which is everything this page shows, with
              every sign-in, setting and install of your own in it. A backup of
              it is taken first, unless one was taken within the hour. Replaced:
              the operating system around it and everything installed into it
              with apt. It takes a minute or two, and every shell closes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Keep it
            </Button>
            <Button variant="destructive" type="submit" form="reset-system">
              Reset the system
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
