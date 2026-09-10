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
  // The OpenRouter key Claude Code on the machine runs on, its hash, and
  // what of its spend the ledger already holds.
  modelKey: string | null;
  modelKeyHash: string | null;
  modelSpentUsd: number;
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
  c.model_key as "modelKey", c.model_key_hash as "modelKeyHash",
  c.model_spent_usd::float as "modelSpentUsd",
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

// The model key the computer runs on, once minted.
export async function setModelKey(
  q: Query,
  id: string,
  key: string,
  hash: string,
) {
  await q.query(
    "update computers set model_key = $2, model_key_hash = $3 where id = $1",
    [id, key, hash],
  );
}

// A key OpenRouter no longer has is forgotten, so the next remake mints
// another.
export async function clearModelKey(q: Query, id: string) {
  await q.query(
    "update computers set model_key = null, model_key_hash = null, model_spent_usd = 0 where id = $1",
    [id],
  );
}

// How much of the key's spend the ledger holds now.
export async function setModelSpent(q: Query, id: string, usd: number) {
  await q.query("update computers set model_spent_usd = $2 where id = $1", [
    id,
    usd,
  ]);
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

// A disk Fly no longer has is forgotten with the machine that would have
// mounted it, so the next step makes both.
export async function clearVolume(q: Query, id: string) {
  await q.query(
    "update computers set volume_id = null, machine_id = null, ready_at = null where id = $1",
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
    resource: "machine" | "disk" | "backup" | "key";
    event:
      | "made"
      | "started"
      | "stopped"
      | "reset"
      | "resized"
      | "grown"
      | "spent"
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

// A port on a computer and a member who may reach it.
export type PortShare = {
  port: number;
  subject: "everyone" | "group" | "member";
  memberId: string | null;
  groupId: string | null;
};

// Every share on a computer. An org scope shows its owner all of them and
// everyone else only what reaches them, so nobody learns what another has
// open.
export async function sharesOn(
  q: Query,
  computerId: string,
): Promise<PortShare[]> {
  return (
    await q.query<PortShare>(
      `select port, subject, member_id as "memberId", group_id as "groupId"
       from port_shares where computer_id = $1
       order by port, subject, member_id, group_id`,
      [computerId],
    )
  ).rows;
}

// Makes what one port reaches exactly this and nothing else: everyone in
// the org, or some groups and some people. Everyone is not a row anywhere,
// so it is a subject of its own rather than a group's id.
export async function sharePort(
  q: Query,
  computerId: string,
  port: number,
  to: { everyone: boolean; groupIds: string[]; memberIds: string[] },
): Promise<void> {
  await q.query(
    `delete from port_shares
     where computer_id = $1 and port = $2
       and not (subject = 'everyone' and $3)
       and (group_id is null or group_id <> all($4::uuid[]))
       and (member_id is null or member_id <> all($5::uuid[]))`,
    [computerId, port, to.everyone, to.groupIds, to.memberIds],
  );
  if (to.everyone) {
    await q.query(
      `insert into port_shares (computer_id, port, subject)
       values ($1, $2, 'everyone') on conflict do nothing`,
      [computerId, port],
    );
  }
  if (to.groupIds.length > 0) {
    await q.query(
      `insert into port_shares (computer_id, port, subject, group_id)
       select $1, $2, 'group', unnest($3::uuid[]) on conflict do nothing`,
      [computerId, port, to.groupIds],
    );
  }
  if (to.memberIds.length > 0) {
    await q.query(
      `insert into port_shares (computer_id, port, subject, member_id)
       select $1, $2, 'member', unnest($3::uuid[]) on conflict do nothing`,
      [computerId, port, to.memberIds],
    );
  }
}

// The computer a machine is, read by anyone in its org. Null when the org
// holds no such machine.
export async function computerByMachine(
  q: Query,
  machineId: string,
): Promise<Computer | null> {
  await q.query("select set_config('app.past_members', 'on', true)");
  return (
    (
      await q.query<Computer>(
        `select ${COLUMNS} from computers c join users u on u.id = c.user_id and u.org_id = c.org_id
         where c.machine_id = $1`,
        [machineId],
      )
    ).rows[0] ?? null
  );
}

export type SharedPort = { machineId: string; port: number; owner: string };

// The ports other people opened to the member reading, by name, by a group
// they are in, or to everyone in the org, with whose each is. Their own
// ports are not among them, and neither is a computer with no machine yet.
export async function portsReaching(q: Query): Promise<SharedPort[]> {
  return (
    await q.query<SharedPort>(
      `select c.machine_id as "machineId", s.port, u.name as owner
       from port_shares s
       join computers c on c.id = s.computer_id
       join users u on u.id = c.user_id
       where c.user_id <> current_member() and c.machine_id is not null
         and (s.subject = 'everyone'
           or s.member_id = current_member()
           or exists (select 1 from group_members m
                      where m.group_id = s.group_id
                        and m.member_id = current_member()))
       group by c.machine_id, s.port, u.name
       order by u.name, s.port`,
    )
  ).rows;
}

// Gives one port to one more subject, leaving whoever already has it. This
// is what accepting the agent's ask does; the sheet on the page sets the
// whole reach instead.
export async function givePort(
  q: Query,
  computerId: string,
  port: number,
  to: { who: "everyone" } | { who: "group" | "member"; id: string },
): Promise<void> {
  await q.query(
    `insert into port_shares (computer_id, port, subject, member_id, group_id)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [
      computerId,
      port,
      to.who,
      to.who === "member" ? to.id : null,
      to.who === "group" ? to.id : null,
    ],
  );
}

// Whether one port of one computer reaches the member reading: by name, by
// a group they are in, or by being open to everyone in the org.
export async function shares(
  q: Query,
  computerId: string,
  port: number,
): Promise<boolean> {
  const said = await q.query(
    `select 1 from port_shares
     where computer_id = $1 and port = $2
       and (subject = 'everyone'
         or member_id = current_member()
         or exists (select 1 from group_members m
                    where m.group_id = port_shares.group_id
                      and m.member_id = current_member()))`,
    [computerId, port],
  );
  return (said.rowCount ?? 0) > 0;
}
