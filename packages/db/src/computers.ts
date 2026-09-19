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
  // What this person may spend on models in a week, in dollars; null for a
  // key minted before the column, which the deployment's default covers.
  modelCapUsd: number | null;
  // The owner's session the machine holds to reach the brain, if any.
  sessionId: string | null;
  // Whether its member is current; a past member's machine is stopped.
  current: boolean;
  // The move under way, if any.
  move: Move | null;
  // The update waiting, if any: the image it goes to, when it became
  // ready, when the person asked for it, and whether it is a security
  // image, which does not wait on them for long.
  updateImage: string | null;
  updateReadyAt: Date | null;
  // Memory in use at the last sweep, and the most seen since the size
  // was last set; null before the first sweep.
  memoryUsedMb: number | null;
  memoryPeakMb: number | null;
};

// A move of a computer to another region, as far as it has got: the
// region, when it was asked for, the snapshot of the old disk, the disk
// and machine made from it there, and, once the row has turned to them,
// the old machine and disk still to be destroyed.
export type Move = {
  to: string;
  askedAt: string;
  snapshotId?: string;
  volumeId?: string;
  machineId?: string;
  old?: { machineId: string; volumeId: string };
};

// Shared CPUs, or dedicated ones: "performance" in Fly's words.
type CpuKind = "shared" | "performance";
export type Size = { cpuKind: CpuKind; cpus: number; memoryMb: number };

const COLUMNS = `c.id, c.org_id as "orgId", c.user_id as "userId", c.region,
  c.cpu_kind as "cpuKind", c.cpus, c.memory_mb as "memoryMb", c.disk_gb as "diskGb", c.secret,
  c.volume_id as "volumeId", c.machine_id as "machineId", c.ready_at as "readyAt",
  c.backed_up_at as "backedUpAt", c.authorized_keys as "authorizedKeys",
  c.model_key as "modelKey", c.model_key_hash as "modelKeyHash",
  c.model_spent_usd::float as "modelSpentUsd", c.model_cap_usd::float as "modelCapUsd",
  c.session_id as "sessionId", c.move,
  c.update_image as "updateImage", c.update_ready_at as "updateReadyAt",
  c.memory_used_mb as "memoryUsedMb", c.memory_peak_mb as "memoryPeakMb",
  (u.removed_at is null) as current`;

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

// The model key the computer runs on, once minted, with the weekly cap it
// was minted against.
export async function setModelKey(
  q: Query,
  id: string,
  key: string,
  hash: string,
  capUsd: number,
) {
  await q.query(
    `update computers set model_key = $2, model_key_hash = $3, model_cap_usd = $4
     where id = $1`,
    [id, key, hash, capUsd],
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

// One public key added to the ones that open SSH, in one statement, so two
// added at once both land and the twenty-key ceiling holds; a key already
// there, by its kind and bytes, is left as it is. Answers the keys as they
// now stand, which hold the key unless the ceiling refused it.
export async function addKey(q: Query, id: string, key: string) {
  const kind = key.split(" ").slice(0, 2).join(" ");
  return (
    await q.query<{ keys: string }>(
      `update computers set authorized_keys = case
         when authorized_keys = '' then $2
         when position($3 in authorized_keys) > 0 then authorized_keys
         when array_length(string_to_array(authorized_keys, E'\n'), 1) >= 20
           then authorized_keys
         else authorized_keys || E'\n' || $2 end
       where id = $1 returning authorized_keys as keys`,
      [id, key, kind],
    )
  ).rows[0]!.keys;
}

// Whose a computer is, as its machine names them: the member's first name
// and their org's slug.
export async function ownerOf(
  q: Query,
  c: Computer,
): Promise<{ firstName: string; orgSlug: string }> {
  await q.query("select set_config('app.past_members', 'on', true)");
  const owner = (
    await q.query<{ firstName: string; orgSlug: string }>(
      `select u.first_name as "firstName", o.slug as "orgSlug"
       from users u join orgs o on o.id = u.org_id where u.id = $1`,
      [c.userId],
    )
  ).rows[0];
  if (!owner) throw new Error(`computer ${c.id}: nobody by id ${c.userId}`);
  return owner;
}

// When the home was last archived.
export async function setBackedUp(q: Query, id: string, at: Date) {
  await q.query("update computers set backed_up_at = $2 where id = $1", [
    id,
    at,
  ]);
}

// The machine's size, as Fly has it: learned back into the row when a
// machine was given more by hand than the row said.
export async function setShape(
  q: Query,
  id: string,
  shape: { cpuKind: string; cpus: number; memoryMb: number },
) {
  await q.query(
    "update computers set cpu_kind = $2, cpus = $3, memory_mb = $4, memory_peak_mb = null where id = $1",
    [id, shape.cpuKind, shape.cpus, shape.memoryMb],
  );
}

// Memory as the sweep found it: what is in use now, and the most seen at
// this size.
export async function setMemory(q: Query, id: string, usedMb: number) {
  await q.query(
    "update computers set memory_used_mb = $2, memory_peak_mb = greatest(memory_peak_mb, $2) where id = $1",
    [id, usedMb],
  );
}

// The disk's size, once Fly has grown it.
export async function setDisk(q: Query, id: string, diskGb: number) {
  await q.query("update computers set disk_gb = $2 where id = $1", [
    id,
    diskGb,
  ]);
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

// An update waiting on the person, to the image named, or nothing once
// the machine is on the image of the day. A fresh image asks again, so
// nothing said about the last one carries an unseen change onto their
// machine.
export async function setUpdate(q: Query, id: string, image: string | null) {
  await q.query(
    `update computers set update_image = $2,
       update_ready_at = case when $2::text is null then null else now() end
     where id = $1`,
    [id, image],
  );
}

// How far the move has got, or null once it is over.
export async function setMove(q: Query, id: string, move: Move | null) {
  await q.query("update computers set move = $2 where id = $1", [
    id,
    move === null ? null : JSON.stringify(move),
  ]);
}

// Turns the row to the machine and disk made in the new region.
export async function setPlace(
  q: Query,
  id: string,
  at: { region: string; volumeId: string; machineId: string },
) {
  await q.query(
    "update computers set region = $2, volume_id = $3, machine_id = $4 where id = $1",
    [id, at.region, at.volumeId, at.machineId],
  );
}

// Where a computer is to be made, while nothing of it exists yet.
export async function setRegion(q: Query, id: string, region: string) {
  await q.query("update computers set region = $2 where id = $1", [id, region]);
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
    resource: "machine" | "disk" | "snapshot" | "backup" | "key" | "update";
    event:
      | "made"
      | "started"
      | "stopped"
      | "reset"
      | "resized"
      | "grown"
      | "capped"
      | "spent"
      | "ready"
      | "scheduled"
      | "restored"
      | "refused"
      // Destroyed is what we took; gone is what the vendor no longer has.
      | "destroyed"
      | "gone";
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

// What the person's model key spent on each day, in dollars, from the
// ledger's own copies: the sweep writes the delta it read with the hour it
// read it, so the days are a sum of those deltas.
export async function spentByDay(
  q: Query,
  userId: string,
  since: Date,
): Promise<{ day: string; usd: number }[]> {
  const r = await q.query<{ day: string; usd: number }>(
    `select to_char(at at time zone 'UTC', 'YYYY-MM-DD') as day,
            sum((detail->>'usd')::numeric)::float as usd
       from ledger
      where user_id = $1 and resource = 'key' and event = 'spent' and at >= $2
      group by 1 order by 1`,
    [userId, since],
  );
  return r.rows;
}

// A port on a computer and who may reach it: a member, a group, everyone
// in the org, or the public, which is anyone with the address.
export type PortShare = {
  port: number;
  subject: "everyone" | "group" | "member" | "public";
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

// Makes what one port reaches exactly this and nothing else: the public,
// everyone in the org, or some groups and some people. Everyone and the
// public are not rows anywhere, so each is a subject of its own rather
// than a group's id.
export async function sharePort(
  q: Query,
  computerId: string,
  port: number,
  to: {
    public: boolean;
    everyone: boolean;
    groupIds: string[];
    memberIds: string[];
  },
): Promise<void> {
  await q.query(
    `delete from port_shares
     where computer_id = $1 and port = $2
       and not (subject = 'everyone' and $3)
       and not (subject = 'public' and $6)
       and (group_id is null or group_id <> all($4::uuid[]))
       and (member_id is null or member_id <> all($5::uuid[]))`,
    [computerId, port, to.everyone, to.groupIds, to.memberIds, to.public],
  );
  for (const subject of ["everyone", "public"] as const) {
    if (!to[subject]) continue;
    await q.query(
      `insert into port_shares (computer_id, port, subject)
       values ($1, $2, $3) on conflict do nothing`,
      [computerId, port, subject],
    );
  }
  await bumpPublic(q, computerId);
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

// A computer by its id, within its org, for the gateway's look at whose
// token this is. Null when the org holds none.
export async function computerById(
  q: Query,
  id: string,
): Promise<Computer | null> {
  await q.query("select set_config('app.past_members', 'on', true)");
  return (
    (
      await q.query<Computer>(
        `select ${COLUMNS} from computers c join users u on u.id = c.user_id and u.org_id = c.org_id
         where c.id = $1`,
        [id],
      )
    ).rows[0] ?? null
  );
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

// A port its owner published: what it is called and what it wears, and
// its place on their shelf.
export type PublishedApp = {
  port: number;
  name: string;
  icon: string | null;
  position: number;
};

// The apps a computer's owner has published, in the order of their shelf.
export async function appsOn(
  q: Query,
  computerId: string,
): Promise<PublishedApp[]> {
  return (
    await q.query<PublishedApp>(
      `select port, name, icon, position from published_apps
       where computer_id = $1 order by position, port`,
      [computerId],
    )
  ).rows;
}

// Publishes a port as an app, or renames one already published: after the
// last on the shelf when new, where it was when not.
export async function publishApp(
  q: Query,
  computerId: string,
  port: number,
  name: string,
  icon: string | null,
): Promise<void> {
  await q.query(
    `insert into published_apps (computer_id, port, name, icon, position)
     values ($1, $2, $3, $4,
       (select coalesce(max(position) + 1, 0) from published_apps where computer_id = $1))
     on conflict (computer_id, port) do update set name = $3, icon = $4`,
    [computerId, port, name, icon],
  );
}

export async function unpublishApp(
  q: Query,
  computerId: string,
  port: number,
): Promise<void> {
  await q.query(
    "delete from published_apps where computer_id = $1 and port = $2",
    [computerId, port],
  );
}

// The shelf in the order given, by port, first to last; an app not named,
// one whose port was not listening as the shelf was dragged, keeps its
// order among the others after them.
export async function arrangeApps(
  q: Query,
  computerId: string,
  ports: number[],
): Promise<void> {
  await q.query(
    `update published_apps a set position = $3 + a.position
     where a.computer_id = $1 and a.port <> all($2::int[])`,
    [computerId, ports, ports.length],
  );
  await q.query(
    `update published_apps a set position = p.at - 1
     from unnest($2::int[]) with ordinality as p (port, at)
     where a.computer_id = $1 and a.port = p.port`,
    [computerId, ports],
  );
}

// A port opened to the member reading, with what its owner published it
// as where they did: a name and a face that travel with it.
export type SharedPort = {
  machineId: string;
  port: number;
  owner: string;
  name: string | null;
  icon: string | null;
};

// The ports other people opened to the member reading, by name, by a group
// they are in, or to everyone in the org, with whose each is. Their own
// ports are not among them, and neither is a computer with no machine yet.
export async function portsReaching(q: Query): Promise<SharedPort[]> {
  return (
    await q.query<SharedPort>(
      `select c.machine_id as "machineId", s.port, u.name as owner,
              a.name as name, a.icon as icon
       from port_shares s
       join computers c on c.id = s.computer_id
       join users u on u.id = c.user_id
       left join published_apps a on a.computer_id = s.computer_id and a.port = s.port
       where c.user_id <> current_member() and c.machine_id is not null
         and (s.subject in ('everyone', 'public')
           or s.member_id = current_member()
           or exists (select 1 from group_members m
                      where m.group_id = s.group_id
                        and m.member_id = current_member()))
       group by c.machine_id, s.port, u.name, a.name, a.icon
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
  to: { who: "everyone" | "public" } | { who: "group" | "member"; id: string },
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
  if (to.who === "public") await bumpPublic(q, computerId);
}

// A change to which ports are public, counted on the computer in the same
// transaction, so the list told to the door carries a number that orders it.
async function bumpPublic(q: Query, computerId: string): Promise<void> {
  await q.query(
    `update computers set public_version = public_version + 1 where id = $1`,
    [computerId],
  );
}

// The ports of one computer open to anyone on the internet, with the
// number of the change that last touched them.
export async function publicPortsOn(
  q: Query,
  computerId: string,
): Promise<{ version: number; ports: number[] }> {
  const { rows } = await q.query<{ version: number; ports: number[] | null }>(
    `select c.public_version as version,
            (select array_agg(s.port order by s.port) from port_shares s
              where s.computer_id = c.id and s.subject = 'public') as ports
     from computers c where c.id = $1`,
    [computerId],
  );
  return { version: rows[0]?.version ?? 0, ports: rows[0]?.ports ?? [] };
}

// Whether one port of one computer reaches the member reading: by name, by
// a group they are in, by being open to everyone in the org, or to anyone.
export async function shares(
  q: Query,
  computerId: string,
  port: number,
): Promise<boolean> {
  const said = await q.query(
    `select 1 from port_shares
     where computer_id = $1 and port = $2
       and (subject in ('everyone', 'public')
         or member_id = current_member()
         or exists (select 1 from group_members m
                    where m.group_id = port_shares.group_id
                      and m.member_id = current_member()))`,
    [computerId, port],
  );
  return (said.rowCount ?? 0) > 0;
}
