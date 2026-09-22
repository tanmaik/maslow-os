"use client";

import { RiDeleteBinLine, RiShareLine } from "@remixicon/react";
import { usePathname, useSearchParams } from "next/navigation";

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
import { FormDialog } from "@/components/form-dialog";

import { ShareFields } from "../sharing";

// What can be done to a set of records at once. Everything here is the door
// doing to many what it does to one, in one transaction.
export function Chosen({
  chosen,
  people,
  groups,
  onDone,
}: {
  chosen: string[];
  people: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  onDone: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const back = `${pathname}${params.toString() ? `?${params}` : ""}`;
  if (chosen.length === 0) return null;
  const many = chosen.length > 1;
  const said = `${chosen.length} record${many ? "s" : ""}`;
  const ids = (
    <>
      <input type="hidden" name="back" value={back} />
      {chosen.map((id) => (
        <input key={id} type="hidden" name="record" value={id} />
      ))}
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
      <span className="text-sm font-medium text-foreground tabular-nums">
        {said} chosen
      </span>
      <span className="flex-1" />
      <FormDialog
        trigger={
          <>
            <RiShareLine data-icon="inline-start" />
            Share
          </>
        }
        title={`Share ${said}`}
      >
        <form action="/brain/selected" method="post" className="grid gap-4">
          {ids}
          <input type="hidden" name="intent" value="share" />
          <ShareFields members={people} groups={groups} />
          <div>
            <Button size="sm" type="submit">
              Share {said}
            </Button>
          </div>
        </form>
      </FormDialog>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
          <RiDeleteBinLine data-icon="inline-start" />
          Remove
        </AlertDialogTrigger>
        <AlertDialogContent>
          <form action="/brain/selected" method="post" className="contents">
            {ids}
            <input type="hidden" name="intent" value="remove" />
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {said}?</AlertDialogTitle>
              <AlertDialogDescription>
                They stop showing here, and the log keeps what they said. Each
                one can be brought back from its own page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep them</AlertDialogCancel>
              <AlertDialogAction type="submit">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      <Button variant="outline" size="sm" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
