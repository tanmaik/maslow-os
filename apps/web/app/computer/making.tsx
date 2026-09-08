"use client";

import { useEffect, useState } from "react";

import { Numbers } from "@/app/computer/numbers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Progress } from "@/components/ui/progress";

type Progress = "off" | "disk" | "machine" | "starting" | "ready";

// What each step says and how far along it is.
const STEPS: Record<Progress, [number, string]> = {
  off: [0, "Computers are off here."],
  disk: [15, "Making your disk"],
  machine: [45, "Making your machine"],
  starting: [75, "Starting it up"],
  ready: [100, "Ready"],
};

// The bar a person watches until their computer is ready: every few
// seconds it asks, and each ask moves the making one step on.
export function Making({
  ready,
  region,
}: {
  ready: boolean;
  region: string | null;
}) {
  const [at, setAt] = useState<Progress>(ready ? "ready" : "disk");
  const [where, setWhere] = useState(region);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (at === "ready") return;
    let stopped = false;
    const ask = async () => {
      try {
        const res = await fetch("/computer/state", { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        const s = (await res.json()) as { progress: Progress; region: string };
        if (stopped) return;
        setAt(s.progress);
        setWhere(s.region);
        setFailed(null);
        if (s.progress !== "ready") setTimeout(ask, 3000);
      } catch (err) {
        if (stopped) return;
        setFailed((err as Error).message);
        setTimeout(ask, 5000);
      }
    };
    void ask();
    return () => {
      stopped = true;
    };
  }, [at === "ready"]);
  const [value, label] = STEPS[at];
  if (at === "ready")
    return (
      <div className="space-y-3">
        <Alert>
          <AlertTitle>Your computer is ready</AlertTitle>
          <AlertDescription>
            Always on, in {where ?? "its region"}.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <form action="/computer/open" method="post">
            <Button type="submit">Open your computer</Button>
          </form>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              Reset
            </AlertDialogTrigger>
            <AlertDialogContent>
              <form action="/computer/reset" method="post" className="contents">
                <AlertDialogHeader>
                  <AlertDialogTitle>Start your Linux over?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Everything you installed with apt or changed outside your
                    home is thrown away and replaced with a fresh Linux. Your
                    home, with your files, packages and settings, is kept.
                    Anything running stops. This takes about a minute.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction type="submit">Reset</AlertDialogAction>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <Numbers />
      </div>
    );
  return (
    <div className="space-y-3">
      <Progress value={value} aria-label={label} />
      <p className="text-muted-foreground text-sm">
        {label}
        {where ? ` in ${where}` : ""}. This takes a minute the first time.
      </p>
      {failed && (
        <p className="text-destructive text-sm">
          Could not get on: {failed}. Trying again.
        </p>
      )}
    </div>
  );
}
