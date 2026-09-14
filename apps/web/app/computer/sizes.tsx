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
import { RadioGroup } from "@/components/base/radio/radio";
import { RadioCard } from "@/components/base/radio/radio-card";
import { SIZES, specs, type SizeKey } from "@/lib/sizes";

// The ladder: the computer's size among the others, each a card with its
// CPUs and memory, and a change that asks first, since it is a restart.
export function Sizes({ current }: { current: SizeKey | null }) {
  const [picked, setPicked] = useState<SizeKey | null>(current);
  const changed = picked !== null && picked !== current;
  const to = picked ? SIZES[picked] : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-body-2-medium text-text-secondary">Size</p>
      <RadioGroup
        aria-label="Size"
        value={picked ?? ""}
        onChange={(v) => setPicked(v as SizeKey)}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(Object.keys(SIZES) as SizeKey[]).map((key) => (
          <RadioCard
            key={key}
            value={key}
            title={SIZES[key].name}
            description={`${specs(SIZES[key])}${key === current ? ", now" : ""}`}
          />
        ))}
      </RadioGroup>
      {changed && (
        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="secondary" size="small" />}
            >
              Change size
            </AlertDialogTrigger>
            <AlertDialogContent>
              <form action="/computer/size" method="post" className="contents">
                <input type="hidden" name="size" value={picked ?? ""} />
                <AlertDialogHeader>
                  <AlertDialogTitle>Move to {to?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {to ? specs(to) : ""}. Your computer restarts into it in a
                    few seconds: anything running stops, and your files and your
                    Linux stay as they are.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction type="submit">
                    Change size
                  </AlertDialogAction>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
