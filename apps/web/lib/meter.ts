import { asMeter, asOrg, type Query } from "@placeholder/db";
import { picturesIn, type Resource, type Unit } from "@placeholder/db/usage";

import { settle } from "./orphans.ts";
import { PRICES } from "./prices.ts";

// The meter. One measuring function reads what a member's things held
// between two moments, in each vendor's own unit; the hourly sweep prices
// and appends that to usage. Nothing reads the ledger yet; it is kept from
// the first day so prices can be set from real use.

export type Measure = {
  resource: Resource;
  unit: Unit;
  quantity: number;
  price: number;
  // What is held right now: so many bytes in the bucket or the brain.
  live: number;
  from: Date;
  to: Date;
};

const seconds = (a: Date, b: Date) =>
  Math.max(0, (b.getTime() - a.getTime()) / 1000);
const later = (a: Date, b: Date) => (a > b ? a : b);

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

// Everything a member held between from and to, from what the rows say.
// Runs inside an org scope with app.member_id set to the member.
export async function measure(
  q: Query,
  userId: string,
  from: Date,
  to: Date,
): Promise<Measure[]> {
  const out: Measure[] = [];
  // Bucket: byte-seconds of the member's profile photo and, on the
  // principal's line, the org's logo.
  const pictures = await picturesIn(q, userId);
  if (pictures.length) {
    let byteSeconds = 0;
    let liveBytes = 0;
    for (const x of pictures) {
      const a = later(x.createdAt, from);
      if (to > a) byteSeconds += x.size * seconds(a, to);
      if (x.createdAt <= to) liveBytes += x.size;
    }
    out.push({
      resource: "bucket",
      unit: "byte_second",
      quantity: byteSeconds,
      price: PRICES.bucket,
      live: liveBytes,
      from,
      to,
    });
  }
  // Brain: what the rows hold now, for the window.
  const bytes = await brainBytes(q, userId);
  if (bytes > 0)
    out.push({
      resource: "brain",
      unit: "byte_second",
      quantity: bytes * seconds(from, to),
      price: PRICES.brain,
      live: bytes,
      from,
      to,
    });
  return out;
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

// The hourly sweep: every org, every member, since their last row, after
// what the org still owes the vendors is paid.
async function sweep(now = new Date()): Promise<number> {
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
    // One org failing does not stop the rest.
    try {
      await settle(orgId);
      if (!orgs.includes(orgId)) continue;
      appended += await asOrg(orgId, async (q) => {
        let n = 0;
        for (const { id } of (
          await q.query<{ id: string }>("select id from users")
        ).rows)
          n += await append(q, orgId, id, now);
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
  now = (await q.query<{ now: Date }>("select now() as now")).rows[0]!.now;
  const fresh = now.getTime() - 3600_000;
  const since = (resource: string) => lasts.get(resource) ?? fresh;
  let n = 0;
  for (const t of new Set([fresh, ...lasts.values()])) {
    let from = new Date(t);
    if (seconds(from, now) <= 0) continue;
    for (const to of ends(from, now)) {
      const measures = (await measure(q, userId, from, to)).filter(
        (m) => since(m.resource) === t,
      );
      for (const m of measures) {
        // A stretch that begins at or after this segment's end belongs to
        // the next segment, never to a row that starts after it ends.
        if (m.from >= to) continue;
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
