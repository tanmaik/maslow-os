"use client";

import {
  RiCheckLine,
  RiDownloadCloud2Line,
  RiFileCopyLine,
} from "@remixicon/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Numbers, useStats } from "@/app/computer/numbers";
import { Updating } from "@/app/computer/updating";
import { Where, type From } from "@/app/computer/region";
import { Row, Rows } from "@/app/settings/row";
import { StatusDot } from "@/components/base/badges/status-dot";
import { Button } from "@/components/base/buttons/button";
import { Progress } from "@/components/ui/progress";
import type { Kept, MoveStep, State, Update } from "@/lib/computer";
import type { Restore } from "@/lib/fly";
import { regionName } from "@/lib/region";
import type { SizeKey } from "@/lib/sizes";
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

// What each step of the making says and how far along it is.
export const STEPS: Record<State["progress"], [number, string]> = {
  off: [0, "Computers are off here."],
  disk: [15, "Making your disk"],
  machine: [45, "Making your machine"],
  starting: [75, "Starting it up"],
  moving: [0, "Moving it"],
  ready: [100, "Ready"],
};

// What each step of a move says and how far along it is; the region's
// name goes where the blank is.
export const MOVE_STEPS: Record<MoveStep, [number, string]> = {
  stopping: [10, "Stopping it"],
  copying: [30, "Copying its disk"],
  restoring: [55, "Restoring the copy in _"],
  starting: [80, "Starting it in _ and checking it answers"],
  clearing: [95, "Clearing away the old one"],
};

// A heading over one part of the pane, on the inset its rows sit on.
export const Head = ({ children }: { children: string }) => (
  <p className="px-3 text-caption-1-medium text-text-secondary">{children}</p>
);

// A command to run elsewhere, with a button that copies it whole.
export function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-2lg bg-background-tertiary-default px-3 py-2.5 font-mono text-caption-1-regular text-text-primary">
        {text}
      </pre>
      <Button
        variant="secondary"
        size="small"
        leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
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

// A size in words, to one decimal, as a person says it.
const size = (bytes: number | null) =>
  bytes === null
    ? ""
    : bytes >= 2 ** 30
      ? `${Math.round((bytes / 2 ** 30) * 10) / 10} GB`
      : `${Math.round(bytes / 2 ** 20)} MB`;

// A day and a time in the person's own words.
const on = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// The backups kept of the home, newest first, each one a folder away.
// Nothing is ever written over: a restore lands beside what is there.
function Backups({ backedUp }: { backedUp: string | null | "off" }) {
  const [kept, setKept] = useState<Kept[] | null>(null);
  const [restoring, setRestoring] = useState<Restore | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const look = useCallback(async () => {
    if (backedUp === "off") return;
    try {
      const res = await fetch("/computer/backups", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const said = (await res.json()) as {
        kept: Kept[];
        restoring: Restore | null;
      } | null;
      setKept(said?.kept ?? []);
      setRestoring(said?.restoring ?? null);
    } catch (err) {
      setFailed((err as Error).message);
    }
  }, [backedUp]);
  useEffect(() => void look(), [look]);
  // While one is coming back, asked after every few seconds, so the
  // person watches it land rather than wondering.
  const coming = restoring !== null && restoring.finishedAt === null;
  useEffect(() => {
    if (!coming) return;
    const beat = setInterval(() => void look(), 3000);
    return () => clearInterval(beat);
  }, [coming, look]);
  const restore = async (key: string) => {
    setFailed(null);
    setAsked(key);
    try {
      const res = await fetch("/computer/backups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error(await res.text());
      await look();
    } catch (err) {
      setFailed((err as Error).message);
      setAsked(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Head>Backups</Head>
      <p className="px-3 text-body-regular text-text-secondary">
        {backedUp === "off"
          ? "No backups here: this deployment has no bucket."
          : backedUp
            ? `Home backed up ${backedUp}; a new one every day, the last fourteen kept. A restore lands in a folder of its own in your home and writes over nothing.`
            : "Home not backed up yet; the first one comes within the hour."}
      </p>
      {restoring && (
        <p className="px-3 text-body-regular text-text-secondary">
          {restoring.error
            ? `The backup from ${restoring.name.replace("restored-", "")} did not come back: ${restoring.error}`
            : restoring.finishedAt
              ? `Restored into ~/${restoring.name}.`
              : restoring.step === "fetching"
                ? `Fetching a backup into ~/${restoring.name}…`
                : `Unpacking ${size(restoring.bytes)} into ~/${restoring.name}…`}
        </p>
      )}
      {failed && (
        <p className="px-3 text-body-regular text-text-error-primary">
          {failed}
        </p>
      )}
      {kept && kept.length > 0 && (
        <Rows>
          {kept.map((b) => (
            <Row
              key={b.key}
              label={on(b.at)}
              description={size(b.bytes) || "size unknown"}
            >
              <Button
                variant="secondary"
                size="small"
                leadingIcon={RiDownloadCloud2Line}
                disabled={coming || asked === b.key}
                onClick={() => void restore(b.key)}
              >
                Restore into a folder
              </Button>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}

// The person's computer once it is ready: what it is, what it is using,
// its ports, its size, where it is, its backups, how a Mac reaches it over
// The computer itself, ready: where and since when, the update if one
// waits, its numbers, size, where, backups and the way to start its Linux
// over. Nothing here opens the computer: the dock does that.
function Ready({
  region,
  since,
  size,
  backedUp,
  update,
  onRestarting,
  door,
  where,
  moveFailed,
}: {
  region: string | null;
  since: string | null;
  size: SizeKey | null;
  backedUp: string | null | "off";
  update: Update | null;
  onRestarting: () => void;
  door: string | null;
  where: From;
  moveFailed: string | null;
}) {
  const { now, samples, failed } = useStats();
  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-center gap-2 px-3 text-body-regular text-text-primary">
        <StatusDot color="green" />
        Ready in {regionName(region ?? "")}
        {since ? `, since ${since}` : ""}.
      </p>
      {moveFailed && (
        <p className="px-3 text-body-regular text-text-error-primary">
          {moveFailed}
        </p>
      )}
      {update && (
        <Updating
          update={update}
          onTake={async () => {
            // A restart takes the best part of a minute to answer, and the
            // pane turns to the bar watching it come back the moment it is
            // asked for, not when the answer lands.
            onRestarting();
            const res = await fetch("/computer/update", { method: "POST" });
            if (!res.ok) throw new Error(await res.text());
          }}
        />
      )}
      <Numbers now={now} samples={samples} failed={failed} size={size} />
      {door && region && <Where current={region} door={door} from={where} />}
      <Backups backedUp={backedUp} />
      <Rows>
        <Row
          label="Start your Linux over"
          description="Throws away everything outside your home and keeps your home."
        >
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="secondary" size="small" />}
            >
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
                    Anything running stops. This takes about a minute. Your
                    backups stay where they are, and any of them can be restored
                    into a folder of your home afterwards.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction type="submit">Reset</AlertDialogAction>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </Row>
      </Rows>
    </div>
  );
}

// The bar a person watches until their computer is ready, starting where
// the computer stands: every few seconds it asks, and each ask moves the
// making, or a move, one step on. While it moves, this is all the page
// shows.
export function Making({
  state: from,
  since,
  size,
  backedUp,
  update,
  door,
  where,
}: {
  state: State;
  // The day the computer first answered its door, as words, null until
  // it has.
  since: string | null;
  size: SizeKey | null;
  // The day the home was last backed up, as words, null before any, or
  // "off" where this deployment has no bucket to back up to.
  backedUp: string | null | "off";
  // The update waiting on the person, if one is.
  update: Update | null;
  // The computer's name and the one command that sets a Mac up to reach it
  // over SSH.
  // Whose account Claude Code on the computer runs on.
  // The computer's own address, once it has one.
  door: string | null;
  where: From;
}) {
  const [state, setState] = useState(from);
  const [failed, setFailed] = useState<string | null>(null);
  // When a restart was asked for, if one was. The machine is still ready
  // for the half minute it takes to stop, so an answer of "ready" in that
  // window is the old machine speaking and is not believed.
  const restarting = useRef(0);
  // What the last step that failed said, kept until the next ask.
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
        if (s.progress === "ready" && Date.now() - restarting.current < 60_000)
          return void setTimeout(ask, 3000);
        restarting.current = 0;
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
      <Ready
        region={state.region}
        since={since}
        size={size}
        backedUp={backedUp}
        update={update}
        onRestarting={() => {
          restarting.current = Date.now();
          setState((was) => ({ ...was, progress: "starting" }));
        }}
        door={door}
        where={where}
        moveFailed={moveFailed}
      />
    );
  if (state.move) {
    const to = regionName(state.move.to);
    const [value, step] = MOVE_STEPS[state.move.step];
    return (
      <div className="flex flex-col gap-3">
        <Progress aria-label={step.replace("_", to)} value={value} />
        <p className="text-body-medium text-text-primary">
          Moving your computer to {to}
        </p>
        <p className="text-body-regular text-text-secondary">
          {step.replace("_", to)}. This takes a few minutes; your files come
          with it, and nothing on the computer can be opened until it is there.
        </p>
        {failed && (
          <p className="text-body-regular text-text-error-primary">
            Could not ask after it: {failed}. Trying again.
          </p>
        )}
      </div>
    );
  }
  const [value, label] = STEPS[at];
  return (
    <div className="flex flex-col gap-3">
      <Progress aria-label={label} value={value} />
      <p className="text-body-regular text-text-secondary">
        {label}
        {state.region ? ` in ${regionName(state.region)}` : ""}. This takes a
        minute the first time.
      </p>
      {moveFailed && (
        <p className="text-body-regular text-text-error-primary">
          {moveFailed}
        </p>
      )}
      {failed && (
        <p className="text-body-regular text-text-error-primary">
          Could not get on: {failed}. Trying again.
        </p>
      )}
    </div>
  );
}
