"use client";

import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useCountUp } from "@/hooks/use-count-up";

// What the room's About says, as its route answers it.
type About = {
  version: string;
  image: string;
  machine: string | null;
  where: string | null;
  size: string | null;
  diskGb: number | null;
  // The update waiting on the person, if one is, and when they said it
  // should be taken.
  update: {
    image: string;
    readyAt: string;
    when: "now" | "tonight" | "idle" | null;
    security: boolean;
  } | null;
  stats: {
    cpu: number;
    memory: { used: number; total: number };
    disk: number | null;
    free: number | null;
    auth: "managed" | "own" | "none" | null;
  } | null;
};

const gb = (bytes: number) => `${Math.round((bytes / 2 ** 30) * 10) / 10} GB`;

// One thing the computer is using: the label, the value rolling up to
// itself, and the share of it as a bar the accent fills.
function Stat({
  name,
  value,
  unit,
  share,
  of,
}: {
  name: string;
  // The value in tenths, so a size in gigabytes rolls a decimal at a time.
  value: number;
  unit: string;
  share: number;
  // How much there is in all, for whoever is hearing this rather than
  // seeing it.
  of?: string;
}) {
  const shown = useCountUp(value);
  const has = unit === "%" ? `${shown}%` : `${shown / 10} ${unit}`;
  const said = of ? `${has} of ${of}` : has;
  return (
    <div className="flex items-center gap-3">
      <div className="text-caption-1-medium text-text-secondary w-16">
        {name}
      </div>
      {/* The number right-aligned and the unit left of the bar, so the
          digits of one row line up with the digits of the next. */}
      <div className="text-body-medium text-text-primary flex w-20 items-baseline tabular-nums">
        <span className="flex-1 text-right">
          {unit === "%" ? shown : shown / 10}
        </span>
        {/* A size takes a space before its unit; a percentage does not. */}
        <span className={`w-6 text-left ${unit === "%" ? "" : "pl-1"}`}>
          {unit}
        </span>
      </div>
      <Progress
        aria-label={name}
        value={Math.min(100, Math.max(0, share))}
        getAriaValueText={() => said}
        className="flex-1"
      />
    </div>
  );
}

// About This Computer, laid out as ryOS lays its own: the mark, the name
// and the version down the left, the facts on the right, a rule, and
// what the computer is using this moment as bars beneath.
export function AboutComputer({
  open,
  onOpenChange,
  whose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Whose computer it is.
  whose: string;
}) {
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => {
    if (!open) return;
    let gone = false;
    void fetch("/room/about")
      .then((r) => (r.ok ? (r.json() as Promise<About>) : null))
      .then((a) => {
        if (!gone) setAbout(a);
      });
    return () => {
      gone = true;
    };
  }, [open]);
  const s = about?.stats ?? null;
  const used = s?.disk != null && s.free != null ? s.disk - s.free : null;
  const tenths = (bytes: number) => Math.round((bytes / 2 ** 30) * 10);
  const bars = s
    ? [
        {
          name: "Memory",
          value: tenths(s.memory.used),
          unit: "GB",
          share: (100 * s.memory.used) / Math.max(s.memory.total, 1),
          of: gb(s.memory.total),
        },
        ...(used != null && s.disk
          ? [
              {
                name: "Disk",
                value: tenths(used),
                unit: "GB",
                share: (100 * used) / s.disk,
                of: gb(s.disk),
              },
            ]
          : []),
        { name: "CPU", value: s.cpu, unit: "%", share: s.cpu },
      ]
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[440px]">
        <DialogTitle className="text-headline-medium border-separator-border text-text-primary border-b px-4 py-2 text-center">
          About This Computer
        </DialogTitle>
        <div className="flex gap-4 p-4">
          <div className="flex w-28 shrink-0 flex-col items-center gap-1 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/dock/computer.png" alt="" className="size-20" />
            <div className="text-title-2-medium text-text-primary">Maslow</div>
            <div className="text-caption-1-regular text-text-secondary">
              {about?.version ?? "…"}
            </div>
          </div>
          <div className="text-body-2-regular text-text-primary flex-1 space-y-4">
            <div className="space-y-0.5">
              {/* The rung of the ladder it sits on, which Settings and the
                  guide both call the size, and which says its memory. */}
              <div>Size: {about?.size ?? "…"}</div>
              <div>
                Disk: {about?.diskGb ? `${about.diskGb} GB` : "…"}
                {s?.free != null && `, ${gb(s.free)} free`}
              </div>
              <div>Where: {about?.where ?? "…"}</div>
            </div>
            <div className="text-caption-1-regular text-text-secondary space-y-0.5">
              <p>
                {whose}&rsquo;s computer · image {about?.image ?? "…"}
              </p>
              {about?.update && (
                <p className="text-text-primary">
                  {about.update.when === "tonight"
                    ? "Restarting tonight at 3:00 to update."
                    : about.update.when === "idle"
                      ? "Restarting to update when idle."
                      : `${about.update.security ? "A security update" : "An update"} is ready. Settings → Computer says when.`}
                </p>
              )}
              <p>machine {about?.machine ?? "not made yet"}</p>
              <p>
                Claude Code on{" "}
                {s?.auth === "own"
                  ? "your own account"
                  : s?.auth === "managed"
                    ? "our key"
                    : "…"}
              </p>
            </div>
          </div>
        </div>
        <hr className="border-separator-border" />
        <div className="space-y-3 px-4 py-3">
          {about && !s && (
            <p className="text-body-2-regular text-text-secondary">
              The computer is not answering just now.
            </p>
          )}
          {bars.map((b) => (
            <Stat key={b.name} {...b} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
