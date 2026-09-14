"use client";

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
import { CloseButton } from "@/components/base/buttons/close-button";

// Takes one link away, asked first and named by the record at its other
// end: a link is one click to destroy and nothing on the page brings it
// back, so nothing destroys it by accident. The × keeps out of the chip
// until the pointer or the keyboard is on it.
export function Unlink({
  action,
  edge,
  title,
  verb,
}: {
  action: string;
  edge: string;
  title: string;
  verb: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <CloseButton
            size="sm"
            aria-label={`Unlink ${title}`}
            title={`Unlink ${title}`}
            className="opacity-0 transition-opacity duration-instant ease-plain group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100"
          />
        }
      />
      <AlertDialogContent>
        <form action={action} method="post" className="contents">
          <input type="hidden" name="intent" value="unlink" />
          <input type="hidden" name="edge" value={edge} />
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The “{verb}” between these two goes. Both records stay, and you
              can link them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the link</AlertDialogCancel>
            <AlertDialogAction type="submit">Unlink</AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
