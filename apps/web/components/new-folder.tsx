"use client";

import { FolderPlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// A new folder inside the one being looked at.
export function NewFolder({ at }: { at: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FolderPlus className="size-4" />
        New folder
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action="/files/folder" method="post" className="space-y-4">
            <DialogHeader>
              <DialogTitle>New folder</DialogTitle>
            </DialogHeader>
            <input type="hidden" name="path" value={at} />
            <Input name="name" placeholder="Name" autoFocus required />
            <DialogFooter>
              <Button type="submit">Make</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
