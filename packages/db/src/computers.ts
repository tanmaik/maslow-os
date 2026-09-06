import { asMachine, asMeter, asOrg, asPerson } from "./index.ts";
import { allowOn } from "./throttle.ts";
import type { Principal } from "./auth.ts";

// What a machine last said it had and needed: its memory and the share of
// it free at each of the last three hours' reports, newest last; what the
// kernel killed for want of memory since boot; the one-minute load over its
// cores at each of those reports; how many terminals were open at the last.
// Each figure carries when it was said, since a report may leave one out
// and the hours a figure speaks for are its own, not the reports'.
type Need = {
  at: string;
  reports?: string[];
  memory?: { total: number; free: number[]; at?: string[] };
  oom?: number;
  load?: number[];
  loadAt?: string[];
  terminals?: number;
  landings?: number;
};

// What a machine says of itself in one report.
export type Said = {
  disk: { used: number; total: number };
  memory?: { total: number; available: number };
  oom?: number;
  load?: number;
  terminals?: number;
  landings?: number;
};

// Forty reports, five minutes apart, is three hours and a quarter: enough
// that three hours of them are in hand even when one arrives late.
export const KEPT = 40;

export type Computer = {
  id: string;
  userId: string;
  region: string;
  size: string;
  diskGb: number;
  volumeId: string | null;
  machineId: string | null;
  state: string;
  seenAt: Date | null;
  diskUsed: number | null;
  diskTotal: number | null;
  need: Need | null;
  // When the person powered it off; null while it is on.
  offAt: Date | null;
  createdAt: Date;
};

const COLUMNS =
  'id, user_id as "userId", region, size, disk_gb as "diskGb", volume_id as "volumeId", machine_id as "machineId", state, seen_at as "seenAt", disk_used::float8 as "diskUsed", disk_total::float8 as "diskTotal", need, off_at as "offAt", created_at as "createdAt"';

// Whether this org has computers: the owner's switch in Settings.
export async function computersAllowed(p: Principal): Promise<boolean> {
  return computersAllowedIn(p.orgId);
}

export async function computersAllowedIn(orgId: string): Promise<boolean> {
  return asOrg(
    orgId,
    async (q) =>
      (await q.query<{ computers: boolean }>("select computers from orgs"))
        .rows[0]?.computers ?? false,
  );
}

// The member behind a computer, for the sweep to act as: null once the
// membership has ended, said outright though the policy hides the past.
export async function principalIn(
  orgId: string,
  userId: string,
): Promise<Principal | null> {
  const row = await asOrg(
    orgId,
    async (q) =>
      (
        await q.query<{ person_id: string; role: Principal["role"] }>(
          "select person_id, role from users where id = $1 and removed_at is null",
          [userId],
        )
      ).rows[0],
  );
  return row
    ? { personId: row.person_id, orgId, userId, role: row.role }
    : null;
}

// The person powered their computer off, or on again.
export async function setOff(
  p: Principal,
  id: string,
  off: boolean,
): Promise<void> {
  // Their own and no colleague's, at the database's clock like every other
  // moment on the row.
  await asPerson(p, (q) =>
    q.query(
      "update computers set off_at = case when $2 then now() end where id = $1 and user_id = $3",
      [id, off, p.userId],
    ),
  );
}

// The signed-in membership's computer, or null before it has one. Read as
// the person, so a membership removed since the request began is refused.
export async function computerOf(p: Principal): Promise<Computer | null> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<Computer>(
          `select ${COLUMNS} from computers where user_id = $1`,
          [p.userId],
        )
      ).rows[0] ?? null,
  );
}

// Claims the membership's one computer before anything is made. False when
// another request already holds it, whether built or still building.
export async function reserveComputer(
  p: Principal,
  c: Pick<Computer, "id" | "region" | "size" | "diskGb"> & { secret: string },
): Promise<boolean> {
  return asOrg(p.orgId, async (q) => {
    const won = await q.query(
      "insert into computers (id, org_id, user_id, region, size, disk_gb) select $1, $2, id, $3, $4, $5 from users where id = $6 on conflict (org_id, user_id) do nothing",
      [c.id, p.orgId, c.region, c.size, c.diskGb, p.userId],
    );
    if (!won.rowCount) return false;
    // The secret is the person's own, kept apart from the row the org sees;
    // written as them.
    await q.query("select set_config('app.member_id', $1, true)", [p.userId]);
    await q.query(
      "insert into computer_secrets (computer_id, org_id, user_id, secret) values ($1, $2, $3, $4)",
      [c.id, p.orgId, p.userId, c.secret],
    );
    await q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, 'created', $2, $3)",
      [c.id, c.size, c.diskGb],
    );
    return true;
  });
}

// The volume exists from this moment: the disk meter starts here, at the
// size it was made.
export async function setVolume(
  p: Principal,
  c: Computer,
  volumeId: string,
  diskGb: number,
): Promise<void> {
  await asOrg(p.orgId, async (q) => {
    await q.query(
      "update computers set volume_id = $1, disk_gb = $2 where id = $3",
      [volumeId, diskGb, c.id],
    );
    await q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, 'volume', $2, $3)",
      [c.id, c.size, diskGb],
    );
  });
}

// Records the machine; false when the row is gone (a purge landed first),
// in which case the caller must not keep the machine.
export async function setMachine(
  orgId: string,
  id: string,
  machineId: string,
): Promise<boolean> {
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query(
          "update computers set machine_id = $1 where id = $2 and machine_id is null",
          [machineId, id],
        )
      ).rowCount === 1,
  );
}

// Why a machine is about to start, or about to be made again: the person
// opened their computer or turned it on, a link was made for a browser,
// the sweep asked for a backup, or it is being sized. The next start, or
// the next size, is that cause's.
export type Cause =
  | "opened"
  | "link-dl"
  | "link-term"
  | "link-p"
  | "backup"
  | "powered-on"
  | "powered-off"
  | "out-of-memory"
  | "short-of-memory"
  | "room-to-spare"
  | "asked-bigger";
export const CAUSES_OF_SIZE: Cause[] = [
  "out-of-memory",
  "short-of-memory",
  "room-to-spare",
  "asked-bigger",
];
// Records something that happened to the machine at our hand, at the time
// it did: a cause, or what we asked of it.
export async function noteEvent(
  orgId: string,
  c: Computer,
  kind: Cause | "start" | "stop" | "restart",
): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, $2, $3, $4)",
      [c.id, kind, c.size, c.diskGb],
    ),
  );
}

// Every event of the member's computer since a moment, oldest first.
export async function eventsOf(
  p: Principal,
  since: Date,
): Promise<{ kind: string; at: Date; size: string }[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<{ kind: string; at: Date; size: string }>(
          `select e.kind, e.at, e.size from computer_events e join computers c on c.id = e.computer_id
           where c.user_id = $1 and (e.at > $2 or e.at = (
             select max(at) from computer_events where computer_id = c.id and at <= $2
               and kind in ('started', 'stopped', 'suspended', 'destroyed', 'failed')))
           order by e.at`,
          [p.userId, since],
        )
      ).rows,
  );
}

// What a machine says of itself, kept if the secret is its own: its disk
// as of now, and its need folded onto the last three hours' reports'. The row is
// held while that is worked out, and written only if it still names the
// machine, so a late report from one let go of says nothing of the next.
// Null when no machine matches, which is the only answer a stranger gets;
// else whose computer spoke, for the sizing that follows.
export async function report(
  machineId: string,
  secret: string,
  said: Said,
  limit: { hits: number; seconds: number },
): Promise<{ orgId: string; id: string } | "too-often" | null> {
  return asMachine(machineId, secret, async (q) => {
    const c = (
      await q.query<{
        id: string;
        org_id: string;
        size: string;
        disk_gb: number;
        need: Need | null;
        off_at: Date | null;
      }>(
        "select id, org_id, size, disk_gb, need, off_at from computers where machine_id = $1 for update",
        [machineId],
      )
    ).rows[0];
    if (!c) return null;
    // Whose machine this is decides its allowance, and the allowance is
    // spent before anything is written, so a report over the limit leaves
    // no mark at all. Counted on this connection: taking a second one
    // while this holds the row is how a pool deadlocks on itself.
    if (!(await allowOn(q, `report:${c.id}`, limit.hits, limit.seconds)))
      return "too-often" as const;
    const now = new Date().toISOString();
    // How many terminals are open, and how many files are landing, are
    // states, and are kept when a report leaves them out; what the kernel
    // killed is the report's own count, so one machine's kills never speak
    // for the hours after them. When each report arrived is kept too, so
    // three hours of reports can be told from a burst of them.
    const need: Need = {
      at: now,
      reports: [...(c.need?.reports ?? []), now].slice(-KEPT),
      oom: said.oom,
      terminals: said.terminals ?? c.need?.terminals,
      landings: said.landings ?? c.need?.landings,
      load: c.need?.load,
      loadAt: c.need?.loadAt,
      memory: c.need?.memory,
    };
    if (said.load !== undefined) {
      need.load = [...(c.need?.load ?? []), said.load].slice(-KEPT);
      need.loadAt = [...(c.need?.loadAt ?? []), now].slice(-KEPT);
    }
    if (said.memory)
      need.memory = {
        total: said.memory.total,
        free: [
          ...(c.need?.memory?.free ?? []),
          Math.round((said.memory.available / said.memory.total) * 1000) / 1000,
        ].slice(-KEPT),
        at: [...(c.need?.memory?.at ?? []), now].slice(-KEPT),
      };
    const kept = await q.query(
      "update computers set seen_at = now(), disk_used = $1, disk_total = $2, need = $3 where id = $4 and machine_id = $5",
      [
        Math.round(said.disk.used),
        Math.round(said.disk.total),
        JSON.stringify(need),
        c.id,
        machineId,
      ],
    );
    if (!kept.rowCount) return null;
    // A report is proof the machine was running at that moment, for the
    // meter, whether or not anyone looked — unless the person powered the
    // computer off, when a report still in flight must not turn it back on.
    if (!c.off_at)
      await q.query(
        "insert into computer_events (org_id, computer_id, kind, size, disk_gb) select org_id, id, 'reported', $2, $3 from computers where id = $1 on conflict do nothing",
        [c.id, c.size, c.disk_gb],
      );
    return { orgId: c.org_id, id: c.id };
  });
}

// The last change of size: when, to what, and why — the cause noted just
// before it. Null for a computer never resized.
export async function lastResizeIn(
  orgId: string,
  id: string,
): Promise<{ at: Date; size: string; why: Cause | null } | null> {
  return asOrg(orgId, async (q) => {
    const r = (
      await q.query<{ at: Date; size: string }>(
        "select at, size from computer_events where computer_id = $1 and kind = 'resized' order by at desc limit 1",
        [id],
      )
    ).rows[0];
    if (!r) return null;
    const why = (
      await q.query<{ kind: Cause }>(
        "select kind from computer_events where computer_id = $1 and at <= $2 and kind = any($3) order by at desc limit 1",
        [id, r.at, CAUSES_OF_SIZE],
      )
    ).rows[0];
    return { at: r.at, size: r.size, why: why?.kind ?? null };
  });
}

// Claims the right to make the computer's next Fly call, for five minutes at
// most; false when another request holds it.
export async function lease(p: Principal, id: string): Promise<string | null> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<{ held: string }>(
          "update computers set busy_until = clock_timestamp() + interval '5 minutes' where id = $1 and (busy_until is null or busy_until < now()) returning busy_until::text as held",
          [id],
        )
      ).rows[0]?.held ?? null,
  );
}

// The same for the sweep, which has no person.
export async function leaseIn(
  orgId: string,
  id: string,
): Promise<string | null> {
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query<{ held: string }>(
          "update computers set busy_until = clock_timestamp() + interval '5 minutes' where id = $1 and (busy_until is null or busy_until < now()) returning busy_until::text as held",
          [id],
        )
      ).rows[0]?.held ?? null,
  );
}

// Lets go of the lease taken, and only that one: a request that outlived
// its five minutes must not clear the lease a newer one holds.
export async function release(
  orgId: string,
  id: string,
  held: string,
): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query(
      "update computers set busy_until = null where id = $1 and busy_until::text = $2",
      [id, held],
    ),
  );
}

// The filesystem grew: the new size is what the meter charges from now.
export async function setDiskGb(
  orgId: string,
  c: Computer,
  diskGb: number,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("update computers set disk_gb = $1 where id = $2", [
      diskGb,
      c.id,
    ]);
    await q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, 'extended', $2, $3)",
      [c.id, c.size, diskGb],
    );
  });
}

// The size the next machine is made at, from this moment. What the old
// one reported of its need no longer speaks for it.
export async function resize(
  p: Principal,
  c: Computer,
  size: string,
): Promise<void> {
  await asOrg(p.orgId, async (q) => {
    await q.query("update computers set size = $1, need = null where id = $2", [
      size,
      c.id,
    ]);
    await q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, 'resized', $2, $3)",
      [c.id, size, c.diskGb],
    );
  });
}

// The states the meter replays: everything that says a machine was on or
// off, whoever said it.
const METERED = [
  "started",
  "reported",
  "start",
  "stopped",
  "suspended",
  "stop",
  "failed",
  "destroyed",
];

// Remembers the state Fly reports, while the row still names the machine
// that state is of, so a late reading cannot speak for the next machine. A
// change the meter reads is an event, judged against the last one written
// rather than the column, so a state noted twice around a state nobody
// noted still closes what it opened; the same state seen twice by two
// readers is one.
export async function noteState(
  orgId: string,
  c: Computer,
  state: string,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    // The update holds the row for the rest of the transaction, so two
    // readers noting the same state serialise and the second sees what the
    // first wrote. A request that no longer speaks for the row's machine
    // touches nothing and says nothing.
    const kept = await q.query(
      "update computers set state = $1 where id = $2 and machine_id is not distinct from $3",
      [state, c.id, c.machineId],
    );
    if (!kept.rowCount) return;
    // Only what the meter replays is an event; a state it does not read is
    // the column's business alone.
    if (!METERED.includes(state)) return;
    await q.query(
      `insert into computer_events (computer_id, kind, size, disk_gb)
       select $1, $2, $3, $4
       where (select kind from computer_events where computer_id = $1 and kind = any($5) order by at desc, id desc limit 1) is distinct from $2
       on conflict do nothing`,
      [c.id, state, c.size, c.diskGb, METERED],
    );
  });
}

// How many times the disk has been extended in the last day, for the
// ceiling on how fast one can grow.
export async function growthsToday(orgId: string, id: string): Promise<number> {
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query<{ n: number }>(
          "select count(*)::int as n from computer_events where computer_id = $1 and kind = 'extended' and at > now() - interval '1 day'",
          [id],
        )
      ).rows[0]!.n,
  );
}

// Fly's own record of a machine's starts and stops, each once, at the
// moment it happened: the proxy wakes and suspends machines without us.
export async function noteEventsIn(
  orgId: string,
  c: Computer,
  events: { status: string; timestamp: number }[],
): Promise<void> {
  const kinds = new Set(["started", "stopped", "suspended", "destroyed"]);
  await asOrg(orgId, async (q) => {
    for (const e of events) {
      if (!kinds.has(e.status)) continue;
      await q.query(
        `insert into computer_events (computer_id, kind, size, disk_gb, at)
         values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
         on conflict (computer_id, kind, at) do nothing`,
        [c.id, e.status, c.size, c.diskGb, e.timestamp],
      );
    }
  });
}

// One computer of the org, by id, for the sweep.
export async function computerOfIn(
  orgId: string,
  id: string,
): Promise<Computer | null> {
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query<Computer>(
          `select ${COLUMNS} from computers where id = $1`,
          [id],
        )
      ).rows[0] ?? null,
  );
}

// Every machine and volume any org's rows name, and every computer that
// names no machine, for the sweep.
export async function knownComputers(): Promise<{
  machines: Set<string>;
  volumes: Map<string, { orgId: string; id: string }>;
  machineless: { orgId: string; id: string }[];
}> {
  return asMeter(async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    const rows = (
      await q.query<{
        id: string;
        org_id: string;
        machine_id: string | null;
        volume_id: string | null;
      }>("select id, org_id, machine_id, volume_id from computers")
    ).rows;
    return {
      machines: new Set(
        rows.flatMap((r) => (r.machine_id ? [r.machine_id] : [])),
      ),
      volumes: new Map(
        rows.flatMap((r) =>
          r.volume_id
            ? [[r.volume_id, { orgId: r.org_id, id: r.id }] as const]
            : [],
        ),
      ),
      machineless: rows
        .filter((r) => !r.machine_id)
        .map((r) => ({ orgId: r.org_id, id: r.id })),
    };
  });
}

// Whether any computer names this machine, for the sweep deciding whether
// an unrecorded one is really unrecorded.
export async function machineIsKnown(machineId: string): Promise<boolean> {
  return asMeter(async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    return Boolean(
      (
        await q.query("select 1 from computers where machine_id = $1", [
          machineId,
        ])
      ).rowCount,
    );
  });
}

// Forgets a volume Fly no longer has, and the machine that was on it.
export async function clearVolume(
  orgId: string,
  id: string,
  volumeId: string,
): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query(
      "update computers set volume_id = null, machine_id = null, state = 'building' where id = $1 and volume_id = $2",
      [id, volumeId],
    ),
  );
}

export async function computersIn(orgId: string): Promise<Computer[]> {
  return asOrg(
    orgId,
    async (q) =>
      (await q.query<Computer>(`select ${COLUMNS} from computers`)).rows,
  );
}

// Forgets a machine Fly no longer has; the filesystem stays.
export async function clearMachine(
  orgId: string,
  id: string,
  machineId: string,
): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query(
      "update computers set machine_id = null where id = $1 and machine_id = $2",
      [id, machineId],
    ),
  );
}

// The machine's secret, for the person it belongs to.
export async function secretOf(p: Principal, id: string): Promise<string> {
  return asPerson(p, async (q) => {
    const row = (
      await q.query<{ secret: string }>(
        "select secret from computer_secrets where computer_id = $1",
        [id],
      )
    ).rows[0];
    if (!row) throw new Error("This computer has no secret.");
    return row.secret;
  });
}

// The machine's secret, for the sweep, which has no person.
export async function secretIn(orgId: string, id: string): Promise<string> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    const row = (
      await q.query<{ secret: string }>(
        "select secret from computer_secrets where computer_id = $1",
        [id],
      )
    ).rows[0];
    if (!row) throw new Error("This computer has no secret.");
    return row.secret;
  });
}
