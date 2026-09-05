import { asMachine, asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

// What a machine last said it had and needed: its memory and the share of
// it free at each of the last few reports, newest last; what the kernel
// killed for want of memory since boot; the one-minute load over its cores.
export type Need = {
  at: string;
  memory?: { total: number; free: number[] };
  oom?: number;
  load?: number;
};

// What a machine says of itself in one report.
export type Said = {
  disk: { used: number; total: number };
  memory?: { total: number; available: number };
  oom?: number;
  load?: number;
};

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
  createdAt: Date;
};

const COLUMNS =
  'id, user_id as "userId", region, size, disk_gb as "diskGb", volume_id as "volumeId", machine_id as "machineId", state, seen_at as "seenAt", disk_used::float8 as "diskUsed", disk_total::float8 as "diskTotal", need, created_at as "createdAt"';

// Whether this org may have computers at all.
export async function computersAllowed(p: Principal): Promise<boolean> {
  return asOrg(
    p.orgId,
    async (q) =>
      (await q.query<{ computers: boolean }>("select computers from orgs"))
        .rows[0]?.computers ?? false,
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
  p: Principal,
  id: string,
  machineId: string,
): Promise<boolean> {
  return asOrg(
    p.orgId,
    async (q) =>
      (
        await q.query(
          "update computers set machine_id = $1 where id = $2 and machine_id is null",
          [machineId, id],
        )
      ).rowCount === 1,
  );
}

// Remembers the state Fly reports. A change is an event; the same state
// seen twice, by two readers at once, is one.
export async function noteState(
  p: Principal,
  c: Computer,
  state: string,
): Promise<void> {
  await asOrg(p.orgId, async (q) => {
    const changed = await q.query(
      "update computers set state = $1 where id = $2 and state is distinct from $1",
      [state, c.id],
    );
    if (!changed.rowCount) return;
    await q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, $2, $3, $4)",
      [c.id, state, c.size, c.diskGb],
    );
  });
}

// Records something we asked of the machine, at the time we asked.
// Why a machine is about to be needed: the person opened their computer,
// a link was made for a browser, the sweep asked for a backup. The next
// start is that cause's.
export async function noteCause(
  orgId: string,
  c: Computer,
  cause: "opened" | "link-dl" | "link-term" | "link-p" | "backup",
): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, $2, $3, $4)",
      [c.id, cause, c.size, c.diskGb],
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

export async function noteRequest(
  p: Principal,
  c: Computer,
  kind: "start" | "stop" | "restart",
): Promise<void> {
  await asOrg(p.orgId, (q) =>
    q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, $2, $3, $4)",
      [c.id, kind, c.size, c.diskGb],
    ),
  );
}

// What a machine says of itself, kept if the secret is its own: its disk
// as of now, and its need folded onto the last few reports'. The row is
// held while that is worked out, and written only if it still names the
// machine, so a late report from one let go of says nothing of the next.
// False when no machine matches, which is the only answer a stranger gets.
export async function report(
  machineId: string,
  secret: string,
  said: Said,
): Promise<boolean> {
  return asMachine(machineId, secret, async (q) => {
    const c = (
      await q.query<{
        id: string;
        size: string;
        disk_gb: number;
        need: Need | null;
      }>(
        "select id, size, disk_gb, need from computers where machine_id = $1 for update",
        [machineId],
      )
    ).rows[0];
    if (!c) return false;
    const need: Need = {
      at: new Date().toISOString(),
      oom: said.oom,
      load: said.load,
    };
    if (said.memory)
      need.memory = {
        total: said.memory.total,
        free: [
          ...(c.need?.memory?.free ?? []),
          Math.round((said.memory.available / said.memory.total) * 1000) / 1000,
        ].slice(-4),
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
    if (!kept.rowCount) return false;
    // A report is proof the machine was running at that moment, for the
    // meter, whether or not anyone looked.
    await q.query(
      "insert into computer_events (org_id, computer_id, kind, size, disk_gb) select org_id, id, 'reported', $2, $3 from computers where id = $1",
      [c.id, c.size, c.disk_gb],
    );
    return true;
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

// Lets go of the lease taken, and only that one: a request that outlived
// its five minutes must not clear the lease a newer one holds.
export async function release(
  p: Principal,
  id: string,
  held: string,
): Promise<void> {
  await asOrg(p.orgId, (q) =>
    q.query(
      "update computers set busy_until = null where id = $1 and busy_until::text = $2",
      [id, held],
    ),
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

export async function releaseIn(
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
  p: Principal,
  c: Computer,
  diskGb: number,
): Promise<void> {
  await asOrg(p.orgId, async (q) => {
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

// Forgets a machine Fly no longer has; the filesystem stays.
export async function clearMachine(
  p: Principal,
  id: string,
  machineId: string,
): Promise<void> {
  await asOrg(p.orgId, (q) =>
    q.query(
      "update computers set machine_id = null where id = $1 and machine_id = $2",
      [id, machineId],
    ),
  );
}

// Remembers a state seen by the sweep rather than a person; same rule.
export async function noteStateIn(
  orgId: string,
  c: Computer,
  state: string,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    const changed = await q.query(
      "update computers set state = $1 where id = $2 and state is distinct from $1",
      [state, c.id],
    );
    if (!changed.rowCount) return;
    await q.query(
      "insert into computer_events (computer_id, kind, size, disk_gb) values ($1, $2, $3, $4)",
      [c.id, state, c.size, c.diskGb],
    );
  });
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

// Forgets a volume Fly no longer has, and the machine that was on it.
export async function clearVolume(
  p: Principal,
  id: string,
  volumeId: string,
): Promise<void> {
  await asOrg(p.orgId, (q) =>
    q.query(
      "update computers set volume_id = null, machine_id = null, state = 'building' where id = $1 and volume_id = $2",
      [id, volumeId],
    ),
  );
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

// Every machine and volume any org's rows name, for the sweep.
export async function knownComputers(): Promise<{
  machines: Set<string>;
  byMachine: Map<string, { orgId: string; id: string }>;
  volumes: Map<string, { orgId: string; id: string }>;
}> {
  const { asMeter } = await import("./index.ts");
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
      byMachine: new Map(
        rows.flatMap((r) =>
          r.machine_id
            ? [[r.machine_id, { orgId: r.org_id, id: r.id }] as const]
            : [],
        ),
      ),
      volumes: new Map(
        rows.flatMap((r) =>
          r.volume_id
            ? [[r.volume_id, { orgId: r.org_id, id: r.id }] as const]
            : [],
        ),
      ),
    };
  });
}

// Forgets a volume Fly no longer has, for the sweep.
export async function clearVolumeIn(
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

// Forgets a machine the sweep found gone.
export async function clearMachineIn(
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
