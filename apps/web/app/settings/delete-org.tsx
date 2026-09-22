"use client";

import { useState } from "react";

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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Deletes the org once its name has been typed exactly.
export function DeleteOrg({ name }: { name: string }) {
  const [typed, setTyped] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
        Delete {name}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action="/auth/delete-org" method="post" className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every member and past member, every record and edge, every
              session: all of it is deleted. Nothing brings it back. Type the
              org&apos;s name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-org-name">
              Type the org&apos;s name
            </FieldLabel>
            <Input
              id="delete-org-name"
              placeholder={name}
              name="name"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              type="submit"
              disabled={typed !== name}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
