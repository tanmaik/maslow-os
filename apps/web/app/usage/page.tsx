import { backupsOf } from "@placeholder/db/backups";
import {
  CAUSES_OF_SIZE,
  computerOf,
  eventsOf,
  type Cause,
} from "@placeholder/db/computers";
import {
  brainByKind,
  picturesOf,
  usageOfMember,
  usageOfOrg,
  type Line,
  type Resource,
} from "@placeholder/db/usage";
import { redirect } from "next/navigation";
import { Fragment, type ReactNode } from "react";

import { LocalTime } from "@/components/local-time";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { disk, DiskError } from "@/lib/disk";
import { filesOf, whole } from "@/lib/files";
import { live } from "@/lib/meter";
import {
  bytes,
  dollars,
  exact,
  LADDER,
  memoryGb,
  MONTH,
  monthly,
  PRICES,
  rate,
  SOURCE,
  spent,
} from "@/lib/prices";
import { principal } from "@/lib/session";

// A stretch of time, in the unit a person would say it.
function spell(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}

// How much was held for how long: gigabytes times time, in months when the
// month has put some behind it, in hours while it is young.
function stored(gbSeconds: number): string {
  const months = gbSeconds / MONTH;
  if (months >= 0.01) return `${months.toFixed(2)} GB-months`;
  const hours = gbSeconds / 3600;
  return `${hours.toFixed(hours < 1 ? 3 : 2)} GB-hours`;
}

// A metered quantity, in the unit a person would say it.
const amount = (unit: string, quantity: number) =>
  unit === "second"
    ? spell(quantity)
    : stored(unit === "gb_second" ? quantity : quantity / 1e9);

// Why a machine came back, in the person's words.
const CAUSE: Record<Cause, string> = {
  opened: "you opened your computer",
  "link-dl": "a download link was followed",
  "link-term": "a terminal was opened",
  "link-p": "a preview was opened",
  backup: "the daily backup",
  "powered-on": "you powered it on",
  "powered-off": "you powered it off",
  "out-of-memory": "it ran out of memory and came back bigger",
  "short-of-memory": "it was short of memory and came back bigger",
  "room-to-spare": "it had room to spare and came back smaller",
  "asked-bigger": "you restarted it with more memory",
};

// What we asked of Fly, which explains a run only when nothing better does.
const REQUEST: Record<string, string> = {
  start: "we started it",
  restart: "the disk grew and it booted again",
};

// Every run of the machine this month: when it started, how long, what it
// cost, and why, from the cause noted just before it.
function sessions(
  events: { kind: string; at: Date; size: string }[],
  from: Date,
  now: Date,
  priceOf: (size: string) => number,
) {
  const clamp = (d: Date) => (d < from ? from : d);
  const out: { at: Date; seconds: number; cost: number; cause: string }[] = [];
  const ANY = "a request reached it";
  // A cause names the run it comes before, and is spent by that run. One
  // written while a machine was already running goes with it when it
  // stops — a page opened an hour ago does not explain the next run —
  // unless it is a reason to make the machine again at another size,
  // which is written while the old one still runs and names the new one.
  let pending = ANY;
  let holds = false;
  let cause = ANY;
  let since: Date | null = null;
  let price = 0;
  for (const e of events) {
    if (e.kind in CAUSE) {
      const sizing = CAUSES_OF_SIZE.includes(e.kind as Cause);
      // A reason to make the machine again at another size is written
      // while the old one still runs, and nothing ordinary that happens
      // in the meantime displaces it; another such reason does.
      if (sizing || !holds) {
        pending = CAUSE[e.kind as Cause]!;
        holds = sizing;
      }
    } else if (e.kind in REQUEST) {
      if (pending === ANY) pending = REQUEST[e.kind]!;
    } else if (e.kind === "started" && !since) {
      since = e.at;
      price = priceOf(e.size);
      cause = pending;
      pending = ANY;
      holds = false;
    } else if (
      ["suspended", "stopped", "destroyed", "failed"].includes(e.kind) &&
      since
    ) {
      const seconds = (e.at.getTime() - clamp(since).getTime()) / 1000;
      out.push({ at: since, seconds, cost: seconds * price, cause });
      since = null;
      if (!holds) pending = ANY;
    }
  }
  if (since) {
    const seconds = (now.getTime() - clamp(since).getTime()) / 1000;
    out.push({
      at: since,
      seconds,
      cost: seconds * price,
      cause: `${cause}, still running`,
    });
  }
  return out.reverse();
}

// A line under a line: one of the things that make it up.
type Detail = {
  key: string;
  what: ReactNode;
  much?: string;
  cost?: string;
  attr?: Record<string, string>;
};

const ORDER: Resource[] = ["compute", "disk", "rootfs", "bucket", "brain"];

const WHAT: Record<Resource, string> = {
  compute: "Machine running",
  disk: "Disk",
  rootfs: "Machine's image, while off",
  bucket: "Bucket",
  brain: "Brain",
};

// One figure in a strip: what it is, then how much.
function Cell({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="text-muted-foreground">{label}</span>{" "}
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

// Exactly what this member, and for an owner the whole org, has used this
// month, what makes up each line, what is ticking now, and what the month
// will come to at this rate. Nobody is billed yet.
export default async function Usage() {
  const p = await principal();
  if (!p) redirect("/");
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const computer = await computerOf(p);
  const [mine, org, ticking, events, backups, staged, pictures, kinds, onDisk] =
    await Promise.all([
      usageOfMember(p, monthStart),
      p.role === "owner" ? usageOfOrg(p, monthStart) : null,
      live(p, now),
      eventsOf(p, monthStart),
      backupsOf(p),
      filesOf(p),
      picturesOf(p),
      brainByKind(p),
      // Read from the machine only if it is up; asking would wake it.
      computer?.machineId && computer.state === "started"
        ? disk.du(p).catch((err) => {
            if (err instanceof DiskError) return { problem: err.message };
            throw err;
          })
        : Promise.resolve(null),
    ]);
  const size = computer?.size ?? LADDER[0]!;
  const runs = sessions(events, monthStart, now, (s) => PRICES.compute[s] ?? 0);
  const projected =
    ticking.month +
    (ticking.ratePerHour * (monthEnd - now.getTime())) / 3600_000;

  const PRICE: Record<Resource, string> = {
    compute: `$${((PRICES.compute[size] ?? 0) * 3600).toFixed(4)} an hour`,
    disk: "$0.15 per GB a month",
    rootfs: "$0.15 per GB a month",
    bucket: "$0.02 per GB a month",
    brain: "$0.35 per GB a month",
  };

  const machine: Detail[] = computer
    ? [
        {
          key: "always-on",
          what: `Runs until you power it off; ≈ ${dollars(monthly(size))} a month at ${memoryGb(size)}.`,
        },
        ...(runs.length
          ? runs.map((r) => ({
              key: r.at.toISOString(),
              what: (
                <>
                  <LocalTime at={r.at} />, {spell(r.seconds)}, {r.cause}
                </>
              ),
              cost: exact(r.cost),
              attr: { "data-session": r.at.toISOString() },
            }))
          : [{ key: "none", what: "It has not run this month." }]),
      ]
    : [];

  const contents: Detail[] = !computer?.volumeId
    ? []
    : !onDisk
      ? [
          {
            key: "not-running",
            what: `A ${computer.diskGb} GB disk; what is on it shows while the machine runs.`,
          },
        ]
      : "problem" in onDisk
        ? [{ key: "problem", what: onDisk.problem }]
        : [
            ...onDisk.folders.map((f) => ({
              key: `folder:${f.path}`,
              what: (
                <a
                  href={`/computer?path=${encodeURIComponent(f.path)}`}
                  className="underline"
                >
                  {f.path}
                </a>
              ),
              much: bytes(f.size),
              attr: { "data-disk-entry": f.path },
            })),
            ...onDisk.files.slice(0, 10).map((f) => ({
              key: `file:${f.path}`,
              what: f.path,
              much: bytes(f.size),
              attr: { "data-disk-file": f.path },
            })),
            {
              key: "os",
              what: "the operating system and what you installed",
              much: bytes(onDisk.os),
            },
            {
              key: "free",
              what: `free, of the ${bytes(onDisk.disk.total)} disk`,
              much: bytes(onDisk.disk.total - onDisk.disk.used),
            },
          ];

  const bucket: Detail[] = [
    ...backups.map((b) => ({
      key: `backup:${b.id}`,
      what: (
        <>
          a backup of your disk, <LocalTime at={b.finishedAt!} />
        </>
      ),
      much: bytes(b.size ?? 0),
      attr: { "data-bucket-backup": b.id },
    })),
    ...staged.files.map((f) => ({
      key: `upload:${f.id}`,
      what: `${f.name}, ${whole(f) ? "landing on your disk" : "still arriving"}`,
      much: bytes(f.size),
      attr: { "data-bucket-upload": f.id },
    })),
    ...pictures.map((x) => ({
      key: `picture:${x.kind}`,
      what: x.kind === "photo" ? "your profile photo" : "the org's logo",
      much: bytes(x.size),
      attr: { "data-bucket-picture": x.kind },
    })),
  ];

  const brain: Detail[] = kinds.map((k) => ({
    key: `kind:${k.kind}`,
    what: `${k.kind}, ${k.records} record${k.records === 1 ? "" : "s"}`,
    much: bytes(k.bytes),
    attr: { "data-brain-kind": k.kind },
  }));

  const details: Record<Resource, Detail[]> = {
    compute: machine,
    disk: contents,
    rootfs: computer
      ? [
          {
            key: "rootfs",
            what: "Its image while off; under a gigabyte.",
          },
        ]
      : [],
    bucket,
    brain,
  };

  const byResource = new Map(mine.map((l) => [l.resource, l]));
  const lines = ORDER.filter(
    (r) => byResource.has(r) || details[r].length > 0,
  ).map((r) => ({ resource: r, line: byResource.get(r), detail: details[r] }));

  const members = new Map<string, { name: string; lines: Line[] }>();
  for (const l of org ?? []) {
    const m = members.get(l.userId) ?? {
      name: l.name ?? "a past member",
      lines: [],
    };
    m.lines.push(l);
    members.set(l.userId, m);
  }

  const row = (d: Detail) => (
    <TableRow key={d.key} {...d.attr}>
      {d.much === undefined && d.cost === undefined ? (
        <TableCell
          colSpan={4}
          className="text-muted-foreground pl-8 whitespace-normal"
        >
          {d.what}
        </TableCell>
      ) : (
        <>
          <TableCell className="text-muted-foreground pl-8 whitespace-normal">
            {d.what}
          </TableCell>
          <TableCell className="text-muted-foreground font-mono tabular-nums">
            {d.much}
          </TableCell>
          <TableCell />
          <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
            {d.cost}
          </TableCell>
        </>
      )}
    </TableRow>
  );

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Nothing is charged yet. This is what your computer, your disk, your
          backups and your brain would cost, at what the vendors charge us. It
          is not everything: reading and writing the bucket, and the database
          behind all of it, are not counted here.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-x-8 gap-y-2"
        data-projection={projected}
      >
        <Cell label="So far this month" value={spent(ticking.month)} />
        <Cell label="Right now" value={rate(ticking.ratePerHour)} />
        <Cell label="By month end" value={`≈ ${dollars(projected)}`} />
      </div>
      {ticking.active.length > 0 && (
        <p className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
          {ticking.active.map((a) => (
            <span key={a.resource} data-ticking={a.resource}>
              {SOURCE[a.resource]} {rate(a.ratePerHour)}
            </span>
          ))}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>What</TableHead>
            <TableHead>How much</TableHead>
            <TableHead>Price</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                Nothing yet.
              </TableCell>
            </TableRow>
          )}
          {lines.map(({ resource, line, detail }) => (
            <Fragment key={resource}>
              <TableRow data-usage={resource}>
                <TableCell className="font-medium">{WHAT[resource]}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {line ? amount(line.unit, line.quantity) : "not billed yet"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {PRICE[resource]}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {line ? exact(line.cost) : "—"}
                </TableCell>
              </TableRow>
              {detail.map(row)}
            </Fragment>
          ))}
          {mine.length > 0 && (
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Billed so far this month. The strip above adds what the last
                sweep has not billed yet.
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {exact(mine.reduce((n, l) => n + l.cost, 0))}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {org && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>How much</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...members.entries()].map(([id, m]) => (
              <Fragment key={id}>
                <TableRow data-member-usage={id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono tabular-nums">
                    {exact(m.lines.reduce((n, l) => n + l.cost, 0))}
                  </TableCell>
                </TableRow>
                {m.lines.map((l) => (
                  <TableRow key={`${id}-${l.resource}`}>
                    <TableCell className="text-muted-foreground pl-8">
                      {WHAT[l.resource]}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono tabular-nums">
                      {amount(l.unit, l.quantity)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                      {exact(l.cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Everyone, billed so far this month
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {exact(org.reduce((n, l) => n + l.cost, 0))}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </main>
  );
}
