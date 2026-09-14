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
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";

// Deletes the org once its name has been typed exactly.
export function DeleteOrg({ name }: { name: string }) {
  const [typed, setTyped] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="danger" size="small" />}>
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
          <Input
            size="small"
            label="Type the org's name"
            placeholder={name}
            name="name"
            autoComplete="off"
            value={typed}
            onChange={setTyped}
          />
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
