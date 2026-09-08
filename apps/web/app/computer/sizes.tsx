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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SIZES, specs, type SizeKey } from "@/lib/sizes";

// The ladder: the computer's size among the others, each with its CPUs
// and memory, and a change that asks first, since it is a restart.
export function Sizes({ current }: { current: SizeKey | null }) {
  const [picked, setPicked] = useState<SizeKey | null>(current);
  const changed = picked !== null && picked !== current;
  const to = picked ? SIZES[picked] : null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Size</p>
      <RadioGroup
        value={picked ?? ""}
        onValueChange={(v) => setPicked(v as SizeKey)}
      >
        {(Object.keys(SIZES) as SizeKey[]).map((key) => (
          <div key={key} className="flex items-center gap-2">
            <RadioGroupItem value={key} id={`size-${key}`} />
            <Label htmlFor={`size-${key}`} className="font-normal">
              <span className="font-medium">{SIZES[key].name}</span>
              <span className="text-muted-foreground">
                {" "}
                {specs(SIZES[key])}
                {key === current ? ", now" : ""}
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      <AlertDialog>
        <AlertDialogTrigger
          render={<Button variant="outline" disabled={!changed} />}
        >
          Change size
        </AlertDialogTrigger>
        <AlertDialogContent>
          <form action="/computer/size" method="post" className="contents">
            <input type="hidden" name="size" value={picked ?? ""} />
            <AlertDialogHeader>
              <AlertDialogTitle>Move to {to?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {to ? specs(to) : ""}. Your computer restarts into it in a few
                seconds: anything running stops, and your files and your Linux
                stay as they are.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction type="submit">Change size</AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
