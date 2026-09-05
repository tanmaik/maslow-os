import { backupsOf } from "@placeholder/db/backups";
import { computerOf, eventsOf } from "@placeholder/db/computers";
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
import { dollars, live } from "@/lib/meter";
import { LADDER, MONTH, PRICES } from "@/lib/prices";
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

const bytes = (n: number) =>
  n < 1e3
    ? `${n} B`
    : n < 1e6
      ? `${(n / 1e3).toFixed(0)} KB`
      : n < 1e9
        ? `${(n / 1e6).toFixed(1)} MB`
        : `${(n / 1e9).toFixed(2)} GB`;

const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

const CAUSE: Record<string, string> = {
  opened: "you opened your computer",
  "link-dl": "a download link was followed",
  "link-term": "a terminal was opened",
  "link-p": "a preview was opened",
  backup: "the daily backup",
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
  let cause = "a request reached it";
  let since: Date | null = null;
  let price = 0;
  for (const e of events) {
    if (e.kind in CAUSE) cause = CAUSE[e.kind]!;
    else if (e.kind === "started" && !since) {
      since = e.at;
      price = priceOf(e.size);
    } else if (
      ["suspended", "stopped", "destroyed", "failed"].includes(e.kind) &&
      since
    ) {
      const seconds = (e.at.getTime() - clamp(since).getTime()) / 1000;
      out.push({ at: since, seconds, cost: seconds * price, cause });
      since = null;
      cause = "a request reached it";
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
          key: "sleep",
          what: "Your machine goes to sleep about a minute after the last request reaches it — 74 seconds, when we timed it — and wakes on the next one in a few seconds; a terminal you leave open keeps it awake. Asleep it costs only its disk and its stopped image.",
        },
        ...(runs.length
          ? runs.map((r) => ({
              key: r.at.toISOString(),
              what: `${when(r.at)}, ${spell(r.seconds)}, ${r.cause}`,
              cost: dollars(r.cost),
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
            key: "asleep",
            what: `A ${computer.diskGb} GB disk. Your machine is asleep, so what is on it is not read from it; open your computer and this fills in.`,
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
              what: `free, of the ${bytes(onDisk.disk.total)} you are paying for`,
              much: bytes(onDisk.disk.total - onDisk.disk.used),
            },
          ];

  const bucket: Detail[] = [
    ...backups.map((b) => ({
      key: `backup:${b.id}`,
      what: `a backup of your disk, ${when(b.finishedAt!)}`,
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
            what: "The machine's own image, kept while it is off so it comes back as you left it. Under a gigabyte.",
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
      <h1 className="text-2xl font-semibold">Usage</h1>

      <p className="text-sm" data-projection={projected}>
        <span className="font-mono tabular-nums">
          {dollars(ticking.ratePerHour)}/h
        </span>{" "}
        right now
        {ticking.active.length > 0 && (
          <>
            {" — "}
            {ticking.active.map((a, i) => (
              <span key={a.resource} data-ticking={a.resource}>
                {i > 0 && ", "}
                {a.what} at {dollars(a.ratePerHour)}/h
              </span>
            ))}
          </>
        )}
        {`. ${dollars(ticking.month)} since ${monthStart.toISOString().slice(0, 10)}, and about ${dollars(projected)} by the end of the month at this rate.`}
      </p>

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
                  {line ? amount(line.unit, line.quantity) : "nothing yet"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {PRICE[resource]}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {line ? dollars(line.cost) : "—"}
                </TableCell>
              </TableRow>
              {detail.map(row)}
            </Fragment>
          ))}
          {mine.length > 0 && (
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Together, this month
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {dollars(mine.reduce((n, l) => n + l.cost, 0))}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <p className="text-muted-foreground text-sm">
        Not metered yet, and not in any figure above: Neon&rsquo;s compute,
        Tigris requests and the bytes leaving it, Vercel, mail, and sign-in.
      </p>

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
                    {dollars(m.lines.reduce((n, l) => n + l.cost, 0))}
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
                      {dollars(l.cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Everyone, this month
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {dollars(org.reduce((n, l) => n + l.cost, 0))}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </main>
  );
}
