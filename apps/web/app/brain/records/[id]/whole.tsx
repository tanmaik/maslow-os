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
import { Button } from "@/components/base/buttons/button";

// What can be done to a whole record rather than to a word in it: the word
// on the control, its mark, and what it is about to do said plainly.
const ACTS = {
  remove: {
    said: "Remove",
    mark: RiDeleteBinLine,
    asks: "Remove this record?",
    means:
      "It stops being read anywhere, and nothing linked to it is touched. You can restore it from this page.",
  },
  restore: {
    said: "Restore",
    mark: RiArrowGoBackLine,
    asks: "Restore this record?",
    means: "It is read again everywhere it was before.",
  },
  unmerge: {
    said: "Unmerge",
    mark: RiGitMergeLine,
    asks: "Take this record back out of the merge?",
    means:
      "It stands on its own again. The record it was merged into keeps everything it has.",
  },
} as const;

export type Act = keyof typeof ACTS;

// The one thing a record's owner does to the record itself, asked before it
// is done: a record is read far more often than it is removed, restored or
// taken back out of a merge.
export function Whole({ action, act }: { action: string; act: Act }) {
  const { said, mark, asks, means } = ACTS[act];
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="secondary"
            size="small"
            leadingIcon={mark}
            iconOnly
            aria-label={said}
            title={said}
            className={
              act === "remove" ? "shrink-0 text-text-error-primary" : "shrink-0"
            }
          />
        }
      />
      <AlertDialogContent>
        <form action={action} method="post" className="contents">
          <input type="hidden" name="intent" value={act} />
          <AlertDialogHeader>
            <AlertDialogTitle>{asks}</AlertDialogTitle>
            <AlertDialogDescription>{means}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction type="submit">{said}</AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
