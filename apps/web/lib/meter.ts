import { asMeter, asOrg, type Query } from "@placeholder/db";
import {
  clearVolume,
  computersIn,
  knownComputers,
  machineIsKnown,
  setMachine,
} from "@placeholder/db/computers";
import { picturesIn, type Resource, type Unit } from "@placeholder/db/usage";

import {
  modelCallsBetween,
  settleLostCalls,
} from "@placeholder/db/model-calls";

import { deployment } from "./deployment.ts";
import { sweepBackups } from "./backups.ts";
import { unpaid, upholdIn } from "./computer.ts";
import { expireUploads, landStaged } from "./files.ts";
import { costOf } from "./models.ts";
import { settle } from "./orphans.ts";
import { fly, machineName } from "./fly.ts";
import { MONTH, PRICES } from "./prices.ts";

// The meter. One measuring function reads what a member's things did
// between two moments, in each vendor's own unit; the hourly sweep prices
// and appends that to usage, and the live meter reads the same function
// for what is unbilled since the last sweep and for the last minute's rate.

export type Measure = {
  resource: Resource;
  // The model, for tokens.
  model?: string;
  unit: Unit;
  quantity: number;
  price: number;
  // What is ticking right now, and how much of it: a running machine, a
  // disk of so many GB, so many bytes in the bucket or the brain.
  live: number;
  liveUnit: string;
  from: Date;
  to: Date;
};

const seconds = (a: Date, b: Date) =>
  Math.max(0, (b.getTime() - a.getTime()) / 1000);
const later = (a: Date, b: Date) => (a > b ? a : b);

// What we asked counts from the moment we asked; what Fly or the daemon
// reported confirms it.
const RUNNING = new Set(["started", "reported", "start"]);
const OFF = new Set(["stopped", "suspended", "stop", "failed", "destroyed"]);

// The bytes the member's own brain rows hold now: a point sample, since
// the rows have no size history of their own, and the one scan of the
// brain the meter makes. What colleagues shared into their view is the
// colleagues' to pay for, so only rows they own count.
async function brainBytes(q: Query, userId: string): Promise<number> {
  return Number(
    (
      await q.query<{ bytes: string }>(
        `select coalesce((select sum(pg_column_size(r.*)) from records r where r.person_id = $1), 0)
              + coalesce((select sum(pg_column_size(e.*)) from edges e where e.person_id = $1), 0)
              + coalesce((select sum(pg_column_size(v.*)) from events v where v.person_id = $1), 0) as bytes`,
        [userId],
      )
    ).rows[0]!.bytes,
  );
}

// Everything a member consumed between from and to, from what the rows
// say. Runs inside an org scope with app.member_id set to the member. The
// brain's bytes are taken as given when the caller has them already.
export async function measure(
  q: Query,
  userId: string,
  from: Date,
  to: Date,
  brain?: number,
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
      await q.query<{ kind: string; size: string; disk_gb: number; at: Date }>(
        "select kind, size, disk_gb, at from computer_events where computer_id = $1 order by at, kind",
        [c.id],
      )
    ).rows;
    // Compute: seconds in "started", replaying states across the window.
    // Each stretch is priced at the size of the event that began it, so a
    // window that spans a resize is one measure per size.
    const start = later(from, c.created_at);
    const stretches = new Map<string, { from: Date; secs: number }>();
    const add = (size: string, since: Date, until: Date) => {
      const s = stretches.get(size) ?? { from: since, secs: 0 };
      s.secs += seconds(since, until);
      stretches.set(size, s);
    };
    let on = false;
    let onSince = start;
    let onSize = c.size;
    for (const e of events) {
      const running = RUNNING.has(e.kind);
      if (!running && !OFF.has(e.kind)) continue;
      if (e.at <= start) {
        on = running;
        onSize = e.size;
        continue;
      }
      if (e.at > to) break;
      if (on && !running) add(onSize, onSince, e.at);
      if (!on && running) {
        onSince = e.at;
        onSize = e.size;
      }
      on = running;
    }
    if (on) add(onSize, onSince, to);
    if (!stretches.size) stretches.set(c.size, { from: start, secs: 0 });
    let secs = 0;
    for (const [size, stretch] of stretches) {
      const price = PRICES.compute[size];
      if (price === undefined) throw new Error(`no price for ${size}`);
      secs += stretch.secs;
      out.push({
        resource: "compute",
        unit: "second",
        quantity: stretch.secs,
        price,
        live: on && size === onSize ? 1 : 0,
        liveUnit: size,
        from: stretch.from,
        to,
      });
    }
    // Root filesystem: Fly charges it while a machine exists and is off,
    // one GB at most for ours. A machine exists from the first state seen
    // of it, a failed build included, until it is destroyed, and the next
    // one made on the volume is its own stretch; a computer with no
    // machine has none.
    let exists = false;
    let existsSince = start;
    let existsFrom: Date | null = null;
    let existed = 0;
    for (const e of events) {
      const gone = e.kind === "destroyed";
      if (!RUNNING.has(e.kind) && !OFF.has(e.kind)) continue;
      if (e.at <= start) {
        exists = !gone;
        continue;
      }
      if (e.at > to) break;
      if (exists) {
        existsFrom ??= existsSince;
        if (gone) existed += seconds(existsSince, e.at);
      } else if (!gone) existsSince = e.at;
      exists = !gone;
    }
    if (exists) {
      existsFrom ??= existsSince;
      existed += seconds(existsSince, to);
    }
    if (existed > 0)
      out.push({
        resource: "rootfs",
        unit: "gb_second",
        quantity: Math.max(0, existed - secs),
        price: PRICES.rootfs,
        live: exists && !on ? 1 : 0,
        liveUnit: "GB",
        from: existsFrom!,
        to,
      });
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
      "select size, ready_at as created_at, deleted_at from files where user_id = $1 and state in ('ready', 'landing') and ready_at is not null",
      [userId],
    )
  ).rows;
  // Backups are the same kind of bytes in the same bucket.
  const backups = (
    await q.query<{ size: string; created_at: Date; deleted_at: Date | null }>(
      "select size, finished_at as created_at, deleted_at from backups where user_id = $1 and finished_at is not null",
      [userId],
    )
  ).rows;
  files.push(...backups);
  // So are the member's profile photo and, on the principal's line, the
  // org's logo.
  for (const x of await picturesIn(q, userId))
    files.push({
      size: String(x.size),
      created_at: x.createdAt,
      deleted_at: null,
    });
  if (files.length) {
    let byteSeconds = 0;
    let liveBytes = 0;
    for (const f of files) {
      const a = later(f.created_at, from);
      const b = f.deleted_at && f.deleted_at < to ? f.deleted_at : to;
      if (b > a) byteSeconds += Number(f.size) * seconds(a, b);
      if (f.created_at <= to && (!f.deleted_at || f.deleted_at > to))
        liveBytes += Number(f.size);
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
  // Brain: what the rows hold now, for the window.
  const bytes = brain ?? (await brainBytes(q, userId));
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
  // Tokens: every call the member's Claude Code made through the gateway
  // in the window, one line per model, at what each call cost. The price is what
  // those tokens came to per token, since input, output and cache are
  // priced apart.
  const byModel = new Map<string, { tokens: number; cost: number }>();
  for (const c of await modelCallsBetween(q, userId, from, to)) {
    const m = byModel.get(c.model) ?? { tokens: 0, cost: 0 };
    m.tokens +=
      c.inputTokens + c.outputTokens + c.cacheReadTokens + c.cacheWriteTokens;
    m.cost += costOf(c);
    byModel.set(c.model, m);
  }
  for (const [model, m] of byModel)
    if (m.tokens > 0)
      out.push({
        resource: "tokens",
        model,
        unit: "token",
        quantity: m.tokens,
        price: m.cost / m.tokens,
        live: 0,
        liveUnit: "tokens",
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
  for (const r of (
    await q.query<{ user_id: string }>("select distinct user_id from backups")
  ).rows)
    ids.add(r.user_id);
  return [...ids];
}

// Runs the sweep if none has run for an hour: from the page, so every
// environment sweeps, cron or not. Production's cron is the backstop for
// hours nobody looks.
// One sweep at a time in this process, and one at a time across every
// instance: the database holds the lock while a sweep runs. `onlyIfDue`
// asks its clock whether an hour has passed, which is what a page look
// wants; the cron sweeps whenever it is called, holding the same lock.
let sweeping: Promise<number> | null = null;
let sweepingDueOnly = true;
function swept(onlyIfDue: boolean): Promise<number> {
  // A sweep the cron asked for is not answered by one a page look started
  // and the clock may refuse: it waits for that to finish and then runs.
  if (sweeping && sweepingDueOnly && !onlyIfDue)
    return sweeping.then(() => swept(false));
  if (!sweeping) {
    sweepingDueOnly = onlyIfDue;
    sweeping = asMeter(async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      const { locked } = (
        await q.query<{ locked: boolean }>(
          "select pg_try_advisory_xact_lock(hashtext('sweep')) as locked",
        )
      ).rows[0]!;
      if (!locked) return 0;
      const { due, now } = (
        await q.query<{ due: boolean; now: Date }>(
          "select coalesce(max(to_at) < now() - interval '1 hour', true) as due, now() as now from usage",
        )
      ).rows[0]!;
      return onlyIfDue && !due ? 0 : sweep(now);
    })
      .catch((err) => {
        console.error(`sweep: ${(err as Error).message}`);
        return 0;
      })
      .finally(() => {
        sweeping = null;
      });
  }
  return sweeping;
}

// Runs the sweep if none has run for an hour: from the page, so every
// environment sweeps, cron or not.
export const sweepIfDue = (): Promise<number> => swept(true);

// Runs it now, for the cron, holding the same lock.
export const sweepNow = (): Promise<number> => swept(false);

// Fly's inventory against ours: a machine or volume in our app that no row
// knows is an incident, said loudly; a volume a row names that Fly no
// longer has is forgotten, so the next look makes a new one. Previews and
// laptops share the app under their own prefixes and are not ours to judge.
async function reconcile(): Promise<void> {
  if (deployment.computers.kind !== "fly") return;
  const prefix = deployment.computers.namePrefix;
  const [machines, volumes] = await Promise.all([
    fly.machines(),
    fly.volumes(),
  ]);
  const known = await knownComputers();
  // A machine's name carries only the first eight characters of the
  // computer's id, so two computers can want the same name. A name that
  // more than one machineless computer answers to names none of them.
  const byName = new Map<string, { orgId: string; id: string } | null>();
  for (const r of known.machineless) {
    const name = machineName(r.id);
    byName.set(name, byName.has(name) ? null : r);
  }
  for (const m of machines) {
    if (!(m.name ?? "").startsWith(`${prefix}c-`) || known.machines.has(m.id))
      continue;
    console.error(`incident: Fly machine ${m.id} (${m.name}) is unrecorded`);
    // Its name names one computer with no machine: this is a build that
    // was cut off before it could be recorded, and it is adopted rather
    // than remade. A name that names two, or none, is a machine nobody
    // can safely be given, and it goes — adopting it into the wrong row
    // would hand one person another's filesystem.
    const owner = byName.get(m.name!);
    const adopted = owner && (await setMachine(owner.orgId, owner.id, m.id));
    if (adopted) {
      console.error(`Fly machine ${m.id} adopted by ${owner.id}`);
      continue;
    }
    // The list was read a moment ago. A build that recorded this machine
    // since is why the adoption failed, and destroying it now would take
    // away a machine somebody's row is pointing at.
    if (await machineIsKnown(m.id)) continue;
    await fly.destroyMachine(m.id).catch(unpaid("machine"));
  }
  for (const v of volumes)
    if (
      v.name.startsWith(`${prefix.replaceAll("-", "_")}c_`) &&
      !known.volumes.has(v.id)
    )
      console.error(`incident: Fly volume ${v.id} (${v.name}) is unrecorded`);
  const have = new Set(volumes.map((v) => v.id));
  for (const [volumeId, { orgId, id }] of known.volumes)
    if (!have.has(volumeId)) {
      console.error(`Fly no longer has volume ${volumeId}; forgotten`);
      await clearVolume(orgId, id, volumeId);
    }
}

// The hourly sweep: every org, every member, since their last row. First
// it upholds each computer — what Fly did to it is on the record, one that
// should be running is, one that should not is stopped — and lets go of
// uploads nobody finished.
async function sweep(now = new Date()): Promise<number> {
  await reconcile().catch((err) =>
    console.error(`reconcile: ${(err as Error).message}`),
  );
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
      if (deployment.computers.kind !== "none" && orgs.includes(orgId)) {
        for (const c of await computersIn(orgId))
          try {
            await upholdIn(orgId, c);
          } catch (err) {
            console.error(`sweep ${c.id}: ${(err as Error).message}`);
          }
      }
      await expireUploads(orgId, now);
      await landStaged(orgId, now);
      await sweepBackups(orgId, now);
      await settle(orgId);
      if (!orgs.includes(orgId)) continue;
      // A call begun over ten minutes ago with no answer written is one
      // the app lost: settled as it stood, marked, and counted.
      await settleLostCalls(orgId, new Date(now.getTime() - 600_000));
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
  // From the database's clock, so a lambda's skew cannot make a window
  // that ends before it began.
  const dbNow = (await q.query<{ now: Date }>("select now() as now")).rows[0]!
    .now;
  now = dbNow;
  const fresh = now.getTime() - 3600_000;
  // Tokens are spent at instants, not held from one sweep to the next: a
  // member's first are billed from the turn of the month, not an hour back.
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const since = (resource: string) =>
    lasts.get(resource) ?? (resource === "tokens" ? monthStart : fresh);
  let n = 0;
  for (const t of new Set([fresh, since("tokens"), ...lasts.values()])) {
    let from = new Date(t);
    if (seconds(from, now) <= 0) continue;
    for (const to of ends(from, now)) {
      const measures = (await measure(q, userId, from, to)).filter(
        (m) => since(m.resource) === t,
      );
      for (const m of measures) {
        // A stretch that begins at or after this segment's end — a disk
        // made after the turn of a month, when the row before it is older
        // — belongs to the next segment, never to a row that starts after
        // it ends.
        if (m.from >= to) continue;
        await q.query(
          "insert into usage (org_id, user_id, resource, model, unit, quantity, price, cost, from_at, to_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing",
          [
            orgId,
            userId,
            m.resource,
            m.model ?? null,
            m.unit,
            m.quantity,
            m.price,
            m.quantity * m.price,
            m.from,
            to,
          ],
        );
        n++;
      }
      from = to;
    }
  }
  return n;
}

// Where a window is cut: the turn of every month it crosses, and its end.
// A row that stays inside one month is that month's whole, so no figure
// has to guess how much of a row fell after a date.
function ends(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const turn = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1),
  );
  while (turn < to) {
    out.push(new Date(turn));
    turn.setUTCMonth(turn.getUTCMonth() + 1);
  }
  out.push(to);
  return out;
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
  // Dollars per hour: what everything ticking costs at this moment.
  ratePerHour: number;
  active: { resource: Resource; ratePerHour: number }[];
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
          // A row written before the meter cut its rows at the turn of a
          // month can straddle it, and counts the share of itself that
          // falls in the month.
          "select coalesce(sum(cost * case when from_at >= $2 then 1 else coalesce(extract(epoch from (to_at - $2)) / nullif(extract(epoch from (to_at - from_at)), 0), 1) end), 0) as cost from usage where user_id = $1 and to_at > $2",
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
    // The brain is scanned once for every window below.
    const brain = await brainBytes(q, p.userId);
    let unbilled = 0;
    for (const t of new Set([monthStart.getTime(), ...lasts.values()]))
      unbilled += (
        await measure(q, p.userId, later(new Date(t), monthStart), now, brain)
      )
        .filter((m) => (lasts.get(m.resource) ?? monthStart.getTime()) === t)
        .reduce((n, m) => n + m.quantity * m.price, 0);
    // What each resource is doing at this instant, from a short window: a
    // rate is what it costs to keep going, never the average of a minute
    // in which it was off for part.
    const minute = await measure(
      q,
      p.userId,
      new Date(now.getTime() - 60_000),
      now,
      brain,
    );
    // The rate is what ticks: a burst of tokens in the last minute is spent,
    // not a pace, so it counts in the month and not in the hour.
    const active = minute
      .filter((m) => m.live > 0)
      .map((m) => ({
        resource: m.resource,
        ratePerHour: (m.resource === "compute" ? 1 : m.live) * m.price * 3600,
      }));
    return {
      at: now.toISOString(),
      month: billed + unbilled,
      ratePerHour: active.reduce((n, a) => n + a.ratePerHour, 0),
      active,
    };
  });
}

// A quantity in a unit people read.
export function amount(resource: string, unit: string, quantity: number) {
  if (unit === "token") return `${quantity.toLocaleString("en")} tokens`;
  if (unit === "run") return `${quantity} ${quantity === 1 ? "run" : "runs"}`;
  if (unit === "second") return `${(quantity / 3600).toFixed(2)} h`;
  if (unit === "gb_second") return `${(quantity / MONTH).toFixed(4)} GB·mo`;
  if (resource === "brain")
    return `${(quantity / MONTH / 1e6).toFixed(4)} MB·mo`;
  return `${(quantity / MONTH / 1e9).toFixed(4)} GB·mo`;
}
