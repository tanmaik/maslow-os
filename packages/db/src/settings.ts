import { asOrg, asPerson, Gone, type Query } from "./index.ts";
import type { Principal, Role } from "./auth.ts";

export type Org = {
  id: string;
  name: string;
  logoKey: string | null;
  principalId: string;
  // Whether members get computers, in production; an owner's switch.
  computers: boolean;
};
export type Member = {
  id: string;
  name: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: Role;
  avatarKey: string | null;
};
export type PastMember = Member & { removedAt: Date };

// Thrown when someone tries what only an owner, or only the principal, may do.
export class Forbidden extends Error {}

// Locks the org and reads who holds it.
async function holdOrg(q: Query): Promise<string> {
  const held = (
    await q.query<{ principal_id: string }>(
      "select principal_id from orgs for update",
    )
  ).rows[0];
  if (!held) throw new Gone("This org was deleted.");
  return held.principal_id;
}

// Locks the org and checks the actor's role from the row itself, not from the
// session's snapshot, so a demotion that lands first is honoured. fn is told
// who the principal is.
async function asOwner<T>(
  p: Principal,
  fn: (q: Query, principal: string) => Promise<T>,
): Promise<T> {
  return asOrg(p.orgId, async (q) => {
    const principal = await holdOrg(q);
    const me = await q.query<{ role: Role }>(
      "select role from users where id = $1",
      [p.userId],
    );
    if (me.rows[0]?.role !== "owner")
      throw new Forbidden("Only an owner can do that.");
    return fn(q, principal);
  });
}

// Locks the org and checks the actor holds it.
async function asPrincipal<T>(
  p: Principal,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return asOrg(p.orgId, async (q) => {
    if ((await holdOrg(q)) !== p.userId)
      throw new Forbidden("Only the principal owner can do that.");
    return fn(q);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Ids arrive from forms; only the canonical spelling is accepted, so a string
// comparison and a uuid comparison agree.
const canonical = (id: string) => (UUID.test(id) ? id : null);

// Shows the org's past memberships to the rest of the transaction.
const seeingPast = (q: Query) =>
  q.query("select set_config('app.past_members', 'on', true)");

// The org as the signed-in person sees it: its name and logo, everyone in
// it, who is invited but not yet arrived, and, for an owner, who has left.
export async function orgOf(p: Principal): Promise<{
  org: Org;
  members: Member[];
  invited: string[];
  past: PastMember[];
}> {
  return asOrg(p.orgId, async (q) => {
    const org = (
      await q.query<Org>(
        'select id, name, logo_key as "logoKey", principal_id as "principalId", computers from orgs',
      )
    ).rows[0]!;
    const members = (
      await q.query<Member>(
        'select id, name, first_name as "firstName", last_name as "lastName", email, role, avatar_key as "avatarKey" from users order by id <> $1, role, name',
        [org.principalId],
      )
    ).rows;
    const invited = (
      await q.query<{ email: string }>(
        "select email from invitations where accepted_at is null order by created_at",
      )
    ).rows.map((r) => r.email);
    const owner = members.find((m) => m.id === p.userId)?.role === "owner";
    if (owner) await seeingPast(q);
    const past = owner
      ? (
          await q.query<PastMember>(
            'select id, name, first_name as "firstName", last_name as "lastName", email, role, avatar_key as "avatarKey", removed_at as "removedAt" from users where removed_at is not null order by removed_at desc',
          )
        ).rows
      : [];
    return { org, members, invited, past };
  });
}

// Switches the org's computers on or off. Owners only.
export async function setComputers(p: Principal, on: boolean): Promise<void> {
  await asOwner(p, (q) => q.query("update orgs set computers = $1", [on]));
}

export async function renameOrg(p: Principal, name: string): Promise<void> {
  await asOwner(p, (q) => q.query("update orgs set name = $1", [name]));
}

// A picture replaced or orphaned is owed its deletion from the bucket, in
// the transaction that forgot its key.
const owePicture = (q: Query, orgId: string, key: string) =>
  q.query(
    "insert into orphans (org_id, kind, ref) values ($1, 'picture', $2)",
    [orgId, key],
  );

// Whether a picture owed its deletion is still shown by anyone, in any
// org; one saved before keys were made per object may be shared.
export async function pictureInUse(
  orgId: string,
  key: string,
): Promise<boolean> {
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query<{ used: boolean }>("select picture_in_use($1) as used", [
          key,
        ])
      ).rows[0]!.used,
  );
}

// Replaces the org's logo with one of so many bytes. Owners only.
export async function setOrgLogo(
  p: Principal,
  key: string,
  bytes: number,
): Promise<void> {
  await asOwner(p, async (q) => {
    const was = (
      await q.query<{ logo_key: string | null }>("select logo_key from orgs")
    ).rows[0]!.logo_key;
    await q.query(
      "update orgs set logo_key = $1, logo_bytes = $2, logo_at = now()",
      [key, bytes],
    );
    if (was) await owePicture(q, p.orgId, was);
  });
}

// A person's name and avatar live on people, and every membership carries a
// copy. One transaction holds the person's row while it writes each
// membership inside its own org, so two writes racing cannot leave the orgs
// disagreeing.
async function setProfile(
  p: Principal,
  fields:
    | { first_name: string; last_name: string | null }
    | { avatar_key: string; avatar_bytes: number },
): Promise<void> {
  const values = Object.values(fields);
  const set = Object.keys(fields)
    .map((c, i) => `${c} = $${i + 2}`)
    .concat("avatar_key" in fields ? ["avatar_at = now()"] : [])
    .join(", ");
  await asPerson(p, async (q) => {
    const person = (
      await q.query<{ email: string; avatar_key: string | null }>(
        "select email, avatar_key from people where id = $1 for update",
        [p.personId],
      )
    ).rows[0];
    if (!person) return;
    await q.query(`update people set ${set} where id = $1`, [
      p.personId,
      ...values,
    ]);
    if ("avatar_key" in fields && person.avatar_key)
      await owePicture(q, p.orgId, person.avatar_key);
    await q.query("select set_config('app.email', $1, true)", [person.email]);
    const orgIds = (
      await q.query<{ org_id: string }>(
        "select org_id from users where email = $1",
        [person.email],
      )
    ).rows.map((r) => r.org_id);
    for (const orgId of orgIds) {
      await q.query("select set_config('app.org_id', $1, true)", [orgId]);
      await q.query(`update users set ${set} where person_id = $1`, [
        p.personId,
        ...values,
      ]);
    }
  });
}

export async function renameSelf(
  p: Principal,
  firstName: string,
  lastName: string | null,
): Promise<void> {
  await setProfile(p, { first_name: firstName, last_name: lastName });
}

// Replaces the person's profile photo with one of so many bytes.
export async function setAvatar(
  p: Principal,
  key: string,
  bytes: number,
): Promise<void> {
  await setProfile(p, { avatar_key: key, avatar_bytes: bytes });
}

// Ends a membership: its sessions, its invitation, and its accounts in
// outside apps. It becomes a past member, kept with everything it wrote,
// unseen, until an owner brings it back or purges it.
async function endMembership(q: Query, id: string): Promise<boolean> {
  await seeingPast(q);
  const leaving = (
    await q.query<{ email: string }>(
      "update users set removed_at = now() where id = $1 and removed_at is null returning email",
      [id],
    )
  ).rows[0];
  if (!leaving) return false;
  // Their compute is owed a stop; the route tries at once, the sweep until
  // it is stopped. A restore forgives it.
  await q.query(
    "insert into orphans (org_id, kind, ref) select org_id, 'stop', machine_id from computers where user_id = $1 and machine_id is not null",
    [id],
  );
  // Access to their apps ends with the membership; brought back, they
  // connect again.
  await q.query(
    "insert into orphans (org_id, kind, ref) values (current_org(), 'accounts', $1)",
    [id],
  );
  await q.query("delete from sessions where user_id = $1", [id]);
  await q.query("delete from invitations where email = $1", [leaving.email]);
  return true;
}

// Removes a member from the org. Owners only; a person cannot remove
// themselves, and nobody removes the principal. The org row is locked so two
// removals cannot each see the other still there.
export async function removeMember(
  p: Principal,
  userId: string,
): Promise<"removed" | "self" | "principal" | "gone"> {
  const id = canonical(userId);
  if (!id) return "gone";
  if (id === p.userId) return "self";
  return asOwner(p, async (q, principal) => {
    if (id === principal) return "principal";
    return (await endMembership(q, id)) ? "removed" : "gone";
  });
}

// Leaves the org. The principal cannot: they hand the org over first, or
// delete it.
export async function leaveOrg(p: Principal): Promise<"left" | "principal"> {
  return asOrg(p.orgId, async (q) => {
    if ((await holdOrg(q)) === p.userId) return "principal";
    await endMembership(q, p.userId);
    return "left";
  });
}

// Hands the org to another member, who becomes an owner and the principal.
// The principal only.
export async function handOver(
  p: Principal,
  userId: string,
): Promise<"handed" | "gone"> {
  const id = canonical(userId);
  if (!id || id === p.userId) return "gone";
  return asPrincipal(p, async (q) => {
    const made = await q.query(
      "update users set role = 'owner' where id = $1",
      [id],
    );
    if (!made.rowCount) return "gone";
    await q.query("update orgs set principal_id = $1", [id]);
    return "handed";
  });
}

// Deletes the org and everything in it: every member and past member, every
// record, every session. The principal only, naming the org exactly.
export async function deleteOrg(
  p: Principal,
  name: string,
): Promise<"deleted" | "mismatch"> {
  return asPrincipal(p, async (q) => {
    const named = await q.query("select 1 from orgs where name = $1", [name]);
    if (!named.rowCount) return "mismatch";
    // Everything the vendors hold for the org is owed before its rows go,
    // in the same transaction: nothing that costs money is left unrecorded.
    await q.query(
      `insert into orphans (org_id, kind, ref)
         select org_id, 'machine', machine_id from computers where machine_id is not null
       union all
         select org_id, 'volume', volume_id from computers where volume_id is not null
       union all
         select id, 'picture', logo_key from orgs where logo_key is not null`,
    );
    await q.query("select set_config('app.meter', 'sweep', true)");
    await q.query(
      `insert into orphans (org_id, kind, ref, extra)
         select org_id, case when upload_id is not null then 'upload' else 'object' end, key, upload_id
           from files where deleted_at is null
       union all
         select org_id, case when upload_id is not null then 'upload' else 'object' end, key, upload_id
           from backups where deleted_at is null`,
    );
    await seeingPast(q);
    await q.query(
      "insert into orphans (org_id, kind, ref) select org_id, 'accounts', id from users",
    );
    const gone = await q.query("delete from orgs where name = $1", [name]);
    return gone.rowCount ? "deleted" : "mismatch";
  });
}

// Brings a past member back as the member they were, with everything they
// wrote, carrying the name and avatar they have today. They sign in and they
// are in. Owners only.
export async function restoreMember(
  p: Principal,
  userId: string,
): Promise<"restored" | "gone"> {
  const id = canonical(userId);
  if (!id) return "gone";
  return asOwner(p, async (q) => {
    await seeingPast(q);
    const past = (
      await q.query<{ email: string; avatar_key: string | null }>(
        "select email, avatar_key from users where id = $1 and removed_at is not null",
        [id],
      )
    ).rows[0];
    if (!past) return "gone";
    await q.query("select set_config('app.email', $1, true)", [past.email]);
    const person = (
      await q.query<{
        first_name: string;
        last_name: string | null;
        avatar_key: string | null;
        avatar_bytes: number | null;
        avatar_at: Date | null;
      }>(
        "select first_name, last_name, avatar_key, avatar_bytes, avatar_at from people where email = $1",
        [past.email],
      )
    ).rows[0]!;
    // The photo the hidden copy held, replaced meanwhile, is let go of.
    if (past.avatar_key && past.avatar_key !== person.avatar_key)
      await owePicture(q, p.orgId, past.avatar_key);
    await q.query(
      "update users set removed_at = null, first_name = $2, last_name = $3, avatar_key = $4, avatar_bytes = $5, avatar_at = $6 where id = $1",
      [
        id,
        person.first_name,
        person.last_name,
        person.avatar_key,
        person.avatar_bytes,
        person.avatar_at,
      ],
    );
    await q.query(
      "delete from orphans where kind = 'stop' and ref in (select machine_id from computers where user_id = $1)",
      [id],
    );
    // A debt for their apps not yet paid is forgiven with them.
    await q.query(
      "delete from orphans where kind = 'accounts' and ref = $1::text",
      [id],
    );
    return "restored";
  });
}

// Whether p may purge this membership: an owner, and the member already
// removed. Asked before anything of theirs is destroyed elsewhere.
export async function canPurge(p: Principal, userId: string): Promise<boolean> {
  const id = canonical(userId);
  if (!id) return false;
  return asOwner(p, async (q) => {
    await seeingPast(q);
    const past = await q.query(
      "select 1 from users where id = $1 and removed_at is not null",
      [id],
    );
    return past.rowCount === 1;
  });
}

// Deletes a past member: the membership and everything it wrote, the log of
// it included. Owners only, and only for someone already removed.
export async function purgeMember(
  p: Principal,
  userId: string,
): Promise<"purged" | "gone"> {
  const id = canonical(userId);
  if (!id) return "gone";
  return asOwner(p, async (q) => {
    await seeingPast(q);
    const past = await q.query(
      "select 1 from users where id = $1 and removed_at is not null",
      [id],
    );
    if (!past.rowCount) return "gone";
    await q.query("select set_config('app.member_id', $1, true)", [id]);
    // Everything of theirs the vendors hold is owed before its row goes.
    await q.query(
      `insert into orphans (org_id, kind, ref)
         select org_id, 'machine', machine_id from computers where user_id = $1 and machine_id is not null
       union all
         select org_id, 'volume', volume_id from computers where user_id = $1 and volume_id is not null`,
      [id],
    );
    await q.query(
      `insert into orphans (org_id, kind, ref, extra)
         select org_id, case when state = 'uploading' and upload_id is not null then 'upload' else 'object' end, key, upload_id
           from files where user_id = $1 and deleted_at is null`,
      [id],
    );
    await q.query(
      `insert into orphans (org_id, kind, ref, extra)
         select org_id, case when upload_id is not null then 'upload' else 'object' end, key, upload_id
           from backups where user_id = $1 and deleted_at is null`,
      [id],
    );
    await q.query("delete from files where user_id = $1", [id]);
    await q.query("delete from backups where user_id = $1", [id]);
    await q.query(
      "delete from computer_events where computer_id in (select id from computers where user_id = $1)",
      [id],
    );
    await q.query("delete from computers where user_id = $1", [id]);
    await q.query("select purge_member($1)", [id]);
    return "purged";
  });
}

// Makes a member an owner, or an owner a member. Owners only; the principal
// stays an owner.
export async function setRole(
  p: Principal,
  userId: string,
  role: Role,
): Promise<"set" | "principal" | "gone"> {
  const id = canonical(userId);
  if (!id) return "gone";
  return asOwner(p, async (q, principal) => {
    if (id === principal && role === "member") return "principal";
    const set = await q.query(
      "update users set role = $1 where id = $2 and role <> $1",
      [role, id],
    );
    return set.rowCount ? "set" : "gone";
  });
}

export async function uninvite(
  p: Principal,
  email: string,
): Promise<"uninvited" | "gone"> {
  const gone = await asOwner(
    p,
    async (q) =>
      (
        await q.query(
          "delete from invitations where email = $1 and accepted_at is null",
          [email],
        )
      ).rowCount,
  );
  return gone ? "uninvited" : "gone";
}
