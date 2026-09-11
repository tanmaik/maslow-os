"use client";

import { useEffect, useState } from "react";

import { Numbers } from "@/app/computer/numbers";
import type { Sharing } from "@/app/computer/ports";
import { Where, type From } from "@/app/computer/region";
import { Sizes } from "@/app/computer/sizes";
import type { MoveStep, State } from "@/lib/computer";
import { regionName } from "@/lib/region";
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
import Link from "next/link";
import { Progress } from "@/components/ui/progress";

// What each step of the making says and how far along it is.
const STEPS: Record<State["progress"], [number, string]> = {
  off: [0, "Computers are off here."],
  disk: [15, "Making your disk"],
  machine: [45, "Making your machine"],
  starting: [75, "Starting it up"],
  moving: [0, "Moving it"],
  ready: [100, "Ready"],
};

// What each step of a move says and how far along it is; the region's
// name goes where the blank is.
const MOVE_STEPS: Record<MoveStep, [number, string]> = {
  stopping: [10, "Stopping it"],
  copying: [30, "Copying its disk"],
  restoring: [55, "Restoring the copy in _"],
  starting: [80, "Starting it in _ and checking it answers"],
  clearing: [95, "Clearing away the old one"],
};

// A command to run elsewhere, with a button that copies it whole.
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <pre className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md p-3 text-xs">
        {text}
      </pre>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

// The bar a person watches until their computer is ready, starting where
// the computer stands: every few seconds it asks, and each ask moves the
// making, or a move, one step on. While it moves, this is all the page
// shows.
export function Making({
  state: from,
  size,
  backedUp,
  ssh,
  model,
  sharing,
  door,
  where,
}: {
  state: State;
  size: SizeKey | null;
  // When the home was last backed up, null before any, or "off" where
  // this deployment has no bucket to back up to.
  backedUp: string | null | "off";
  // The computer's name, the one command that sets a Mac up to reach it
  // over SSH, and whether a key opens it yet.
  ssh: { name: string; command: string; keys: boolean } | null;
  // Whose account Claude Code on the computer runs on.
  model: { kind: "ours"; capUsd: number } | { kind: "mine" };
  sharing: Sharing | null;
  // The computer's own address, once it has one.
  door: string | null;
  where: From;
}) {
  const [state, setState] = useState(from);
  const [failed, setFailed] = useState<string | null>(null);
  // What the last move said when it failed, kept until the next one.
  const [moveFailed, setMoveFailed] = useState<string | null>(null);
  const at = state.progress;
  useEffect(() => {
    if (at === "ready") return;
    let stopped = false;
    const ask = async () => {
      try {
        const res = await fetch("/computer/state", { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        const s = (await res.json()) as State;
        if (stopped) return;
        setState(s);
        setFailed(null);
        if (s.failed) setMoveFailed(s.failed);
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
  if (at === "ready")
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>Your computer is ready</AlertTitle>
          <AlertDescription>
            Always on, in {regionName(state.region ?? "")}. Open it and Claude
            Code is already running in its terminal; its browser has a page of
            its own.
          </AlertDescription>
        </Alert>
        {moveFailed && <p className="text-destructive text-sm">{moveFailed}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            render={<Link href="/computer/terminal" />}
          >
            Open your computer
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/browser" />}
          >
            Its browser
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          {backedUp === "off"
            ? "No backups here: this deployment has no bucket."
            : backedUp
              ? `Home backed up ${new Date(backedUp).toLocaleString()}; a new one every day, the last fourteen kept.`
              : "Home not backed up yet; the first one comes within the hour."}
        </p>
        <Numbers
          capUsd={model.kind === "ours" ? model.capUsd : null}
          sharing={sharing}
          size={size}
        />
        <Sizes current={size} />
        {door && state.region && (
          <Where current={state.region} door={door} from={where} />
        )}
        {ssh && (
          <div className="space-y-2">
            <p className="text-sm font-medium">SSH</p>
            <p className="text-muted-foreground text-sm">
              Your computer is <code>{ssh.name}</code>. Run this once on your
              Mac, and <code>ssh {ssh.name}</code> lands in the same terminal
              the Terminal page shows.
            </p>
            <Command text={ssh.command} />
            <p className="text-muted-foreground text-sm">
              {ssh.keys ? (
                "It opens with the public key in your settings."
              ) : (
                <>
                  It opens with your public key, and your settings have none
                  yet:{" "}
                  <Link
                    className="underline underline-offset-4"
                    href="/settings#ssh"
                  >
                    add one
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">Reset</p>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              Start your Linux over
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
      </div>
    );
  if (state.move) {
    const to = regionName(state.move.to);
    const [value, step] = MOVE_STEPS[state.move.step];
    return (
      <div className="space-y-3">
        <Progress value={value} aria-label={step.replace("_", to)} />
        <p className="text-sm font-medium">Moving your computer to {to}</p>
        <p className="text-muted-foreground text-sm">
          {step.replace("_", to)}. This takes a few minutes; your files come
          with it, and nothing on the computer can be opened until it is there.
        </p>
        {failed && (
          <p className="text-destructive text-sm">
            Could not ask after it: {failed}. Trying again.
          </p>
        )}
      </div>
    );
  }
  const [value, label] = STEPS[at];
  return (
    <div className="space-y-3">
      <Progress value={value} aria-label={label} />
      <p className="text-muted-foreground text-sm">
        {label}
        {state.region ? ` in ${regionName(state.region)}` : ""}. This takes a
        minute the first time.
      </p>
      {moveFailed && <p className="text-destructive text-sm">{moveFailed}</p>}
      {failed && (
        <p className="text-destructive text-sm">
          Could not get on: {failed}. Trying again.
        </p>
      )}
    </div>
  );
}
