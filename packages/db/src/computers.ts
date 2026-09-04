import { asMachine, asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

export type Computer = {
  id: string;
  userId: string;
  region: string;
  size: string;
  diskGb: number;
  secret: string;
  volumeId: string | null;
  machineId: string | null;
  state: string;
  seenAt: Date | null;
  diskUsed: number | null;
  diskTotal: number | null;
  createdAt: Date;
};

const COLUMNS =
  'id, user_id as "userId", region, size, disk_gb as "diskGb", secret, volume_id as "volumeId", machine_id as "machineId", state, seen_at as "seenAt", disk_used::float8 as "diskUsed", disk_total::float8 as "diskTotal", created_at as "createdAt"';

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

// Any membership's computer in the org, for the owner removing them.
export async function computerOfMember(
  p: Principal,
  userId: string,
): Promise<Computer | null> {
  return asOrg(
    p.orgId,
    async (q) =>
      (
        await q.query<Computer>(
          `select ${COLUMNS} from computers where user_id = $1`,
          [userId],
        )
      ).rows[0] ?? null,
  );
}

// Claims the membership's one computer before anything is made. False when
// another request already holds it, whether built or still building.
export async function reserveComputer(
  p: Principal,
  c: Pick<Computer, "id" | "region" | "size" | "diskGb" | "secret">,
): Promise<boolean> {
  return asOrg(p.orgId, async (q) => {
    const won = await q.query(
      "insert into computers (id, org_id, user_id, region, size, disk_gb, secret) select $1, $2, id, $3, $4, $5, $6 from users where id = $7 on conflict (org_id, user_id) do nothing",
      [c.id, p.orgId, c.region, c.size, c.diskGb, c.secret, p.userId],
    );
    if (!won.rowCount) return false;
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

// What a machine says of itself, kept if the secret is its own. False when
// no machine matches, which is the only answer a stranger gets.
export async function report(
  machineId: string,
  secret: string,
  disk: { used: number; total: number },
): Promise<boolean> {
  return asMachine(machineId, secret, async (q) => {
    const seen = await q.query<{ id: string; size: string; disk_gb: number }>(
      "update computers set seen_at = now(), disk_used = $1, disk_total = $2 where machine_id = $3 returning id, size, disk_gb",
      [Math.round(disk.used), Math.round(disk.total), machineId],
    );
    const c = seen.rows[0];
    if (!c) return false;
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
