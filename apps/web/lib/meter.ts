import { asMeter, asOrg, type Query } from "@placeholder/db";
import {
  clearMachineIn,
  computersIn,
  noteStateIn,
} from "@placeholder/db/computers";

import { deployment } from "./deployment.ts";
import { expireUploads } from "./files.ts";
import { settle } from "./orphans.ts";
import { fly } from "./fly.ts";
import { PRICES } from "./prices.ts";

// The meter. One measuring function reads what a member's things did
// between two moments, in each vendor's own unit; the hourly sweep prices
// and appends that to usage, and the live meter reads the same function
// for what is unbilled since the last sweep and for the last minute's rate.

export type Resource = "compute" | "rootfs" | "disk" | "bucket" | "brain";
export type Unit = "second" | "gb_second" | "byte_second";

export type Measure = {
  resource: Resource;
  unit: Unit;
  quantity: number;
  price: number;
  // What is ticking right now, and how much of it: a running machine, a
  // filesystem of so many GB, so many bytes of files or brain.
  live: number;
  liveUnit: string;
  from: Date;
  to: Date;
};

const seconds = (a: Date, b: Date) =>
  Math.max(0, (b.getTime() - a.getTime()) / 1000);
const later = (a: Date, b: Date) => (a > b ? a : b);

// Everything a member consumed between from and to, from what the rows
// say. Runs inside an org scope with app.member_id set to the member.
export async function measure(
  q: Query,
  userId: string,
  from: Date,
  to: Date,
): Promise<Measure[]> {
  const out: Measure[] = [];
  const c = (
    await q.query<{
      id: string;
      size: string;
      volume_id: string | null;
      machine_id: string | null;
      created_at: Date;
    }>(
      "select id, size, volume_id, machine_id, created_at from computers where user_id = $1",
      [userId],
    )
  ).rows[0];
  if (c) {
    const events = (
      await q.query<{ kind: string; disk_gb: number; at: Date }>(
        "select kind, disk_gb, at from computer_events where computer_id = $1 order by at, kind",
        [c.id],
      )
    ).rows;
    const price = PRICES.compute[c.size];
    if (price === undefined) throw new Error(`no price for ${c.size}`);
    // Compute: seconds in "started", replaying states across the window.
    const start = later(from, c.created_at);
    let on = false;
    let onSince = start;
    let secs = 0;
    for (const e of events) {
      // What we asked counts from the moment we asked; what Fly or the daemon
      // reported confirms it.
      const running = ["started", "reported", "start"].includes(e.kind);
      const off = [
        "stopped",
        "suspended",
        "failed",
        "destroyed",
        "stop",
      ].includes(e.kind);
      if (!running && !off) continue;
      if (e.at <= start) {
        on = running;
        continue;
      }
      if (e.at > to) break;
      if (on && !running) secs += seconds(onSince, e.at);
      if (!on && running) onSince = e.at;
      on = running;
    }
    if (on) secs += seconds(onSince, to);
    out.push({
      resource: "compute",
      unit: "second",
      quantity: secs,
      price,
      live: on ? 1 : 0,
      liveUnit: c.size,
      from: start,
      to,
    });
    // Root filesystem: Fly charges it while a machine exists and is stopped,
    // one GB at most for ours. A machine exists from its placement until it
    // is destroyed; a filesystem with no machine has none.
    const placedAt = events.find((e) => e.kind === "stopped")?.at;
    const destroyedAt = events.find((e) => e.kind === "destroyed")?.at;
    if (placedAt && (c.machine_id || (destroyedAt && destroyedAt > from))) {
      const machineAt = later(start, placedAt);
      const existed = seconds(
        machineAt,
        destroyedAt && destroyedAt < to ? destroyedAt : to,
      );
      if (existed > 0)
        out.push({
          resource: "rootfs",
          unit: "gb_second",
          quantity: Math.max(0, existed - secs),
          price: PRICES.rootfs,
          live: on || !c.machine_id ? 0 : 1,
          liveUnit: "GB",
          from: machineAt,
          to,
        });
    }
    // Disk: GB-seconds from the moment the volume existed, the size changing
    // at each extension.
    const volumeEvent = events.find((e) => e.kind === "volume");
    if (c.volume_id) {
      const diskStart = later(from, volumeEvent?.at ?? c.created_at);
      let gb =
        (volumeEvent ?? events.find((e) => e.kind === "created"))?.disk_gb ?? 0;
      let at = diskStart;
      let gbSeconds = 0;
      for (const e of events) {
        if (e.kind !== "extended") continue;
        if (e.at <= diskStart) {
          gb = e.disk_gb;
          continue;
        }
        if (e.at > to) break;
        gbSeconds += gb * seconds(at, e.at);
        gb = e.disk_gb;
        at = e.at;
      }
      gbSeconds += gb * seconds(at, to);
      out.push({
        resource: "disk",
        unit: "gb_second",
        quantity: gbSeconds,
        price: PRICES.disk,
        live: gb,
        liveUnit: "GB",
        from: diskStart,
        to,
      });
    }
  }
  // Files: byte-seconds of every file alive in the window.
  const files = (
    await q.query<{ size: string; created_at: Date; deleted_at: Date | null }>(
      "select size, ready_at as created_at, deleted_at from files where user_id = $1 and state = 'ready' and ready_at is not null",
      [userId],
    )
  ).rows;
  if (files.length) {
    let byteSeconds = 0;
    let liveBytes = 0;
    for (const f of files) {
      const a = later(f.created_at, from);
      const b = f.deleted_at && f.deleted_at < to ? f.deleted_at : to;
      if (b > a) byteSeconds += Number(f.size) * seconds(a, b);
      if (!f.deleted_at || f.deleted_at > to) liveBytes += Number(f.size);
    }
    out.push({
      resource: "bucket",
      unit: "byte_second",
      quantity: byteSeconds,
      price: PRICES.bucket,
      live: liveBytes,
      liveUnit: "bytes",
      from,
      to,
    });
  }
  // Brain: the bytes the member's rows hold now, for the window. A point
  // sample; the rows have no size history of their own.
  const bytes = Number(
    (
      await q.query<{ bytes: string }>(
        `select coalesce((select sum(pg_column_size(r.*)) from records r), 0)
              + coalesce((select sum(pg_column_size(e.*)) from edges e), 0)
              + coalesce((select sum(pg_column_size(v.*)) from events v where v.person_id = $1), 0) as bytes`,
        [userId],
      )
    ).rows[0]!.bytes,
  );
  if (bytes > 0)
    out.push({
      resource: "brain",
      unit: "byte_second",
      quantity: bytes * seconds(from, to),
      price: PRICES.brain,
      live: bytes,
      liveUnit: "bytes",
      from,
      to,
    });
  return out;
}

// The members whose things the org is paying for: everyone in it, and
// anyone removed whose computer or files still exist.
async function membersOf(q: Query): Promise<string[]> {
  const ids = new Set<string>();
  for (const r of (await q.query<{ id: string }>("select id from users")).rows)
    ids.add(r.id);
  for (const r of (
    await q.query<{ user_id: string }>("select user_id from computers")
  ).rows)
    ids.add(r.user_id);
  // Files of a member with no computer, as the meter sees them.
  await q.query("select set_config('app.meter', 'sweep', true)");
  for (const r of (
    await q.query<{ user_id: string }>("select distinct user_id from files")
  ).rows)
    ids.add(r.user_id);
  return [...ids];
}

// The hourly sweep: every org, every member, since their last row. First
// it asks Fly what each machine is doing, so a state nobody looked at is
// still an event, and lets go of uploads nobody finished.
export async function sweep(now = new Date()): Promise<number> {
  const orgs = await asMeter(async (q) =>
    (await q.query<{ id: string }>("select id from orgs")).rows.map(
      (r) => r.id,
    ),
  );
  // Debts of orgs that no longer exist are still paid.
  const owing = await asMeter(async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    return (
      await q.query<{ org_id: string }>("select distinct org_id from orphans")
    ).rows.map((r) => r.org_id);
  });
  let appended = 0;
  for (const orgId of new Set([...orgs, ...owing])) {
    // One org, or one machine, failing does not stop the rest.
    try {
      if (deployment.computers.kind !== "none")
        for (const c of await computersIn(orgId)) {
          if (!c.machineId) continue;
          try {
            const m = await fly.machine(c.machineId);
            await noteStateIn(orgId, c, m ? m.state : "destroyed");
            if (!m) await clearMachineIn(orgId, c.id, c.machineId);
          } catch (err) {
            console.error(`sweep ${c.machineId}: ${(err as Error).message}`);
          }
        }
      await expireUploads(orgId, now);
      await settle(orgId);
      if (!orgs.includes(orgId)) continue;
      appended += await asOrg(orgId, async (q) => {
        let n = 0;
        for (const userId of await membersOf(q))
          n += await append(q, orgId, userId, now);
        return n;
      });
    } catch (err) {
      console.error(`sweep ${orgId}: ${(err as Error).message}`);
    }
  }
  return appended;
}

async function append(q: Query, orgId: string, userId: string, now: Date) {
  await q.query("select set_config('app.member_id', $1, true)", [userId]);
  // Each resource continues from its own last row, so two sweeps that
  // raced leave no gap and no overlap.
  const lasts = new Map(
    (
      await q.query<{ resource: string; last: Date }>(
        "select resource, max(to_at) as last from usage where user_id = $1 group by resource",
        [userId],
      )
    ).rows.map((r) => [r.resource, r.last.getTime()]),
  );
  const fresh = now.getTime() - 3600_000;
  let n = 0;
  for (const t of new Set([fresh, ...lasts.values()])) {
    const from = new Date(t);
    if (seconds(from, now) <= 0) continue;
    const measures = (await measure(q, userId, from, now)).filter(
      (m) => (lasts.get(m.resource) ?? fresh) === t,
    );
    for (const m of measures) {
      await q.query(
        "insert into usage (org_id, user_id, resource, unit, quantity, price, cost, from_at, to_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing",
        [
          orgId,
          userId,
          m.resource,
          m.unit,
          m.quantity,
          m.price,
          m.quantity * m.price,
          m.from,
          now,
        ],
      );
      n++;
    }
  }
  return n;
}

// One member, now: what they cost until this moment, before their rows go.
export async function sweepMember(
  orgId: string,
  userId: string,
): Promise<void> {
  await asOrg(orgId, (q) => append(q, orgId, userId, new Date()));
}

export type Live = {
  at: string;
  // Billed this month plus what is unbilled since the last sweep.
  month: number;
  // Dollars per hour, from the last sixty seconds.
  ratePerHour: number;
  active: { resource: Resource; what: string; ratePerHour: number }[];
};

// What one person costs right now.
export async function live(
  p: { orgId: string; userId: string },
  now = new Date(),
): Promise<Live> {
  return asOrg(p.orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [p.userId]);
    const monthStart = new Date(now);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const billed = Number(
      (
        await q.query<{ cost: string }>(
          "select coalesce(sum(cost * extract(epoch from (to_at - greatest(from_at, $2))) / nullif(extract(epoch from (to_at - from_at)), 0)), 0) as cost from usage where user_id = $1 and to_at > $2",
          [p.userId, monthStart],
        )
      ).rows[0]!.cost,
    );
    // Unbilled per resource from that resource's own last row, so nothing
    // already in the ledger is counted again.
    const lasts = new Map(
      (
        await q.query<{ resource: string; last: Date }>(
          "select resource, max(to_at) as last from usage where user_id = $1 group by resource",
          [p.userId],
        )
      ).rows.map((r) => [r.resource, r.last.getTime()]),
    );
    let unbilled = 0;
    for (const t of new Set([monthStart.getTime(), ...lasts.values()]))
      unbilled += (await measure(q, p.userId, new Date(t), now))
        .filter((m) => (lasts.get(m.resource) ?? monthStart.getTime()) === t)
        .reduce((n, m) => n + m.quantity * m.price, 0);
    const minute = await measure(
      q,
      p.userId,
      new Date(now.getTime() - 60_000),
      now,
    );
    const ratePerHour =
      minute.reduce((n, m) => n + m.quantity * m.price, 0) * 60;
    const active = minute
      .filter((m) => m.live > 0)
      .map((m) => ({
        resource: m.resource,
        what:
          m.resource === "compute"
            ? `${m.liveUnit} running`
            : m.resource === "rootfs"
              ? `stopped machine's ${m.live} GB image`
              : m.resource === "disk"
                ? `${m.live} GB filesystem`
                : m.resource === "bucket"
                  ? `${human(m.live)} of files`
                  : `${human(m.live)} of brain`,
        ratePerHour: (m.resource === "compute" ? 1 : m.live) * m.price * 3600,
      }));
    return {
      at: now.toISOString(),
      month: billed + unbilled,
      ratePerHour,
      active,
    };
  });
}

const human = (bytes: number) =>
  bytes < 1e6
    ? `${(bytes / 1e3).toFixed(1)} KB`
    : bytes < 1e9
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${(bytes / 1e9).toFixed(2)} GB`;

// Dollars to the fraction of a cent, as the owner asked to see them.
export const dollars = (n: number) =>
  n < 0.01 && n > 0 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;

// A quantity in a unit people read.
export function amount(resource: string, unit: string, quantity: number) {
  const MONTH = 730 * 3600;
  if (unit === "second") return `${(quantity / 3600).toFixed(2)} h`;
  if (unit === "gb_second") return `${(quantity / MONTH).toFixed(4)} GB·mo`;
  if (resource === "brain")
    return `${(quantity / MONTH / 1e6).toFixed(4)} MB·mo`;
  return `${(quantity / MONTH / 1e9).toFixed(4)} GB·mo`;
}
