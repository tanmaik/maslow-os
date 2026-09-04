"use client";

import { MoreHorizontal } from "lucide-react";
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
import { Input } from "@/components/ui/input";

type Target = { file: string } | { folder: string };

// What can be done to a file or a folder: download, rename, move, delete.
// Each is a form to a route; rename and move ask first.
export function FileActions({
  target,
  name,
  at,
  downloadHref,
}: {
  target: Target;
  name: string;
  at: string;
  downloadHref?: string;
}) {
  const [asking, setAsking] = useState<"rename" | "move" | null>(null);
  const hidden = (
    <>
      <input type="hidden" name="path" value={at} />
      {"file" in target ? (
        <input type="hidden" name="file" value={target.file} />
      ) : (
        <input type="hidden" name="folder" value={target.folder} />
      )}
    </>
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" aria-label="Actions" />}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {downloadHref && (
            <DropdownMenuItem render={<a href={downloadHref} />}>
              Download
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setAsking("rename")}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAsking("move")}>
            Move to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            render={
              <button
                type="submit"
                form={`delete-${"file" in target ? target.file : target.folder}`}
              />
            }
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form
        id={`delete-${"file" in target ? target.file : target.folder}`}
        action="/files/delete"
        method="post"
        className="hidden"
      >
        {hidden}
      </form>

      <Dialog
        open={asking === "rename"}
        onOpenChange={(o) => !o && setAsking(null)}
      >
        <DialogContent>
          <form action="/files/rename" method="post" className="space-y-4">
            <DialogHeader>
              <DialogTitle>Rename</DialogTitle>
              <DialogDescription>{name}</DialogDescription>
            </DialogHeader>
            {hidden}
            <Input name="name" defaultValue={name} autoFocus required />
            <DialogFooter>
              <Button type="submit">Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={asking === "move"}
        onOpenChange={(o) => !o && setAsking(null)}
      >
        <DialogContent>
          <form action="/files/move" method="post" className="space-y-4">
            <DialogHeader>
              <DialogTitle>Move {name}</DialogTitle>
              <DialogDescription>
                To a folder, by path. One that does not exist is made.
              </DialogDescription>
            </DialogHeader>
            {hidden}
            <Input
              name="to"
              defaultValue={at}
              placeholder="/photos/2026"
              autoFocus
              required
            />
            <DialogFooter>
              <Button type="submit">Move</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
