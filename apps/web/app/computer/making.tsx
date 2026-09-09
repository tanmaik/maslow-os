"use client";

import { useEffect, useState } from "react";

import { BrowserView } from "@/app/computer/browser";
import { Numbers } from "@/app/computer/numbers";
import { Sizes } from "@/app/computer/sizes";
import type { SizeKey } from "@/lib/sizes";
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

// The bar a person watches until their computer is ready, starting where
// the computer stands: every few seconds it asks, and each ask moves the
// making one step on.
export function Making({
  at: from,
  region,
  size,
  backedUp,
  ssh,
  model,
}: {
  at: Progress;
  region: string | null;
  size: SizeKey | null;
  // When the home was last backed up, null before any, or "off" where
  // this deployment has no bucket to back up to.
  backedUp: string | null | "off";
  // Where the computer answers SSH and whether a key opens it yet.
  ssh: { host: string; keys: boolean } | null;
  // Whose account Claude Code on the computer runs on.
  model: { kind: "ours"; capUsd: number } | { kind: "mine" };
}) {
  const [at, setAt] = useState<Progress>(from);
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
        <Numbers capUsd={model.kind === "ours" ? model.capUsd : null} />
        <Sizes current={size} />
        <p className="text-muted-foreground text-sm">
          A computer found with its memory nearly full is moved up one size on
          its own, a restart of a few seconds; never down.
        </p>
        <BrowserView />
        {ssh && (
          <div className="space-y-2">
            <p className="text-sm font-medium">From your own terminal</p>
            {ssh.keys ? (
              <>
                <p className="text-muted-foreground text-sm">
                  Put{" "}
                  <a
                    className="underline underline-offset-4"
                    href="/maslow-ssh"
                  >
                    maslow-ssh
                  </a>{" "}
                  in your ~/.ssh folder, add this to ~/.ssh/config, and{" "}
                  <code>ssh computer</code> opens a terminal; VS Code and file
                  apps that read that file follow. Python 3 is all it needs.
                </p>
                <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
                  {`Host computer\n  HostName ${ssh.host}\n  User me\n  ProxyCommand python3 ~/.ssh/maslow-ssh %h`}
                </pre>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Add a public key under SSH in Settings and the way in appears
                here.
              </p>
            )}
          </div>
        )}
        <p className="text-muted-foreground text-sm">
          {backedUp === "off"
            ? "No backups here: this deployment has no bucket."
            : backedUp
              ? `Home backed up ${new Date(backedUp).toLocaleString()}; a new one every day, the last fourteen kept.`
              : "Home not backed up yet; the first one comes within the hour."}
        </p>
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
