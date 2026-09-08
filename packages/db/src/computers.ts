import { randomBytes, randomUUID } from "node:crypto";

import type { Query } from "./index.ts";

// A computer's row: one per membership, claimed at sign-in, filled in as
// Fly hands back each id. Read inside an org scope or the sweep's.
export type Computer = {
  id: string;
  orgId: string;
  userId: string;
  region: string;
  cpuKind: CpuKind;
  cpus: number;
  memoryMb: number;
  diskGb: number;
  secret: string;
  volumeId: string | null;
  machineId: string | null;
  readyAt: Date | null;
  // When the home was last archived into the bucket, if ever.
  backedUpAt: Date | null;
  // The public keys that open SSH, one per line; empty until set.
  authorizedKeys: string;
  // The owner's session the machine holds to reach the brain, if any.
  sessionId: string | null;
  // Whether its member is current; a past member's machine is stopped.
  current: boolean;
};

// Shared CPUs, or dedicated ones: "performance" in Fly's words.
type CpuKind = "shared" | "performance";
export type Size = { cpuKind: CpuKind; cpus: number; memoryMb: number };

const COLUMNS = `c.id, c.org_id as "orgId", c.user_id as "userId", c.region,
  c.cpu_kind as "cpuKind", c.cpus, c.memory_mb as "memoryMb", c.disk_gb as "diskGb", c.secret,
  c.volume_id as "volumeId", c.machine_id as "machineId", c.ready_at as "readyAt",
  c.backed_up_at as "backedUpAt", c.authorized_keys as "authorizedKeys",
  c.session_id as "sessionId", (u.removed_at is null) as current`;

// Claims a computer for a member, at a size, in a region: one per
// membership, however many sign-ins race for it.
export async function claimComputer(
  q: Query,
  orgId: string,
  userId: string,
  region: string,
  size: Size & { diskGb: number },
): Promise<void> {
  await q.query(
    `insert into computers (org_id, user_id, region, cpu_kind, cpus, memory_mb, disk_gb, secret)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (org_id, user_id) do nothing`,
    [
      orgId,
      userId,
      region,
      size.cpuKind,
      size.cpus,
      size.memoryMb,
      size.diskGb,
      randomBytes(24).toString("base64url"),
    ],
  );
}

// The public keys that open SSH, as the person set them.
export async function setKeys(q: Query, id: string, keys: string) {
  await q.query("update computers set authorized_keys = $2 where id = $1", [
    id,
    keys,
  ]);
}

// When the home was last archived.
export async function setBackedUp(q: Query, id: string, at: Date) {
  await q.query("update computers set backed_up_at = $2 where id = $1", [
    id,
    at,
  ]);
}

// The disk's size, once Fly has grown it.
export async function setDisk(q: Query, id: string, diskGb: number) {
  await q.query("update computers set disk_gb = $2 where id = $1", [
    id,
    diskGb,
  ]);
}

// The size the computer is to be; the machine follows at its next remake.
export async function setSize(q: Query, id: string, size: Size) {
  await q.query(
    "update computers set cpu_kind = $2, cpus = $3, memory_mb = $4 where id = $1",
    [id, size.cpuKind, size.cpus, size.memoryMb],
  );
}

// The member's computer, or null before it is claimed.
export async function computerOf(
  q: Query,
  userId: string,
): Promise<Computer | null> {
  await q.query("select set_config('app.past_members', 'on', true)");
  return (
    (
      await q.query<Computer>(
        `select ${COLUMNS} from computers c join users u on u.id = c.user_id and u.org_id = c.org_id
         where c.user_id = $1`,
        [userId],
      )
    ).rows[0] ?? null
  );
}

// Every computer in the org, past members' included, for the sweep.
export async function allComputers(q: Query): Promise<Computer[]> {
  await q.query("select set_config('app.past_members', 'on', true)");
  return (
    await q.query<Computer>(
      `select ${COLUMNS} from computers c join users u on u.id = c.user_id and u.org_id = c.org_id
       order by c.created_at`,
    )
  ).rows;
}

// The org's current members with no computer yet, for the sweep to claim.
export async function membersWithoutComputers(q: Query): Promise<string[]> {
  return (
    await q.query<{ id: string }>(
      `select u.id from users u
       where u.removed_at is null
         and not exists (select 1 from computers c where c.org_id = u.org_id and c.user_id = u.id)`,
    )
  ).rows.map((r) => r.id);
}

// Holds the computer for the rest of the transaction, so one request at a
// time talks to Fly about it; false when another already does.
export async function holdComputer(q: Query, id: string): Promise<boolean> {
  return (
    await q.query<{ held: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1)) as held",
      [`computer:${id}`],
    )
  ).rows[0]!.held;
}

export async function setVolume(q: Query, id: string, volumeId: string) {
  await q.query("update computers set volume_id = $2 where id = $1", [
    id,
    volumeId,
  ]);
}

export async function setMachine(q: Query, id: string, machineId: string) {
  await q.query("update computers set machine_id = $2 where id = $1", [
    id,
    machineId,
  ]);
}

// A machine Fly no longer has is forgotten, so the next step makes one.
export async function clearMachine(q: Query, id: string) {
  await q.query(
    "update computers set machine_id = null, ready_at = null where id = $1",
    [id],
  );
}

// Opens a session of the owner's for the computer to hold, named so the
// person sees it beside their apps and can end it there, and keeps its id
// on the row. The session id, which with the org's is the token.
export async function openComputerSession(
  q: Query,
  c: { id: string; orgId: string; userId: string },
): Promise<string> {
  const sessionId = randomUUID();
  await q.query(
    "insert into sessions (id, org_id, user_id, client) values ($1, $2, $3, 'Your computer')",
    [sessionId, c.orgId, c.userId],
  );
  await q.query("update computers set session_id = $2 where id = $1", [
    c.id,
    sessionId,
  ]);
  return sessionId;
}

export async function setReady(q: Query, id: string, ready: boolean) {
  await q.query(
    "update computers set ready_at = case when $2 then coalesce(ready_at, now()) else null end where id = $1",
    [id, ready],
  );
}

// Writes what happened to a resource: whose, what, and why.
export async function note(
  q: Query,
  entry: {
    orgId: string;
    userId: string | null;
    resource: "machine" | "disk" | "backup";
    event:
      | "made"
      | "started"
      | "stopped"
      | "reset"
      | "resized"
      | "grown"
      | "destroyed";
    ref: string | null;
    detail?: Record<string, unknown>;
    why: string;
  },
): Promise<void> {
  await q.query(
    `insert into ledger (org_id, user_id, resource, event, ref, detail, why)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.orgId,
      entry.userId,
      entry.resource,
      entry.event,
      entry.ref,
      JSON.stringify(entry.detail ?? {}),
      entry.why,
    ],
  );
}
