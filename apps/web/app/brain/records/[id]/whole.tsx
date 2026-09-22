"use client";

import {
  RiArrowGoBackLine,
  RiDeleteBinLine,
  RiGitMergeLine,
} from "@remixicon/react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// What can be done to a whole record rather than to a word in it: the word
// on the control, its mark, and what it is about to do said plainly.
const ACTS = {
  remove: {
    said: "Delete",
    mark: RiDeleteBinLine,
    asks: "Delete this record?",
    means:
      "It will no longer appear anywhere. Nothing linked to it is affected, and you can restore it from this page.",
  },
  restore: {
    said: "Restore",
    mark: RiArrowGoBackLine,
    asks: "Restore this record?",
    means: "It will appear again everywhere it did before.",
  },
  unmerge: {
    said: "Unmerge",
    mark: RiGitMergeLine,
    asks: "Unmerge this record?",
    means:
      "It will stand on its own again. The record it was merged into keeps everything.",
  },
} as const;

export type Act = keyof typeof ACTS;

// The one thing a record's owner does to the record itself, asked before it
// is done: a record is read far more often than it is removed, restored or
// taken back out of a merge.
export function Whole({
  action,
  act,
  back,
}: {
  action: string;
  act: Act;
  // Where the page comes back to once it is done.
  back: string;
}) {
  const { said, mark: Mark, asks, means } = ACTS[act];
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={said}
            title={said}
            className="shrink-0"
          />
        }
      >
        <Mark />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={action} method="post" className="contents">
          <input type="hidden" name="intent" value={act} />
          <input type="hidden" name="back" value={back} />
          <AlertDialogHeader>
            <AlertDialogTitle>{asks}</AlertDialogTitle>
            <AlertDialogDescription>{means}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit">{said}</AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
