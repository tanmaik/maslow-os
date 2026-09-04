import { asOrg, asPerson, type Query } from "./index.ts";
import type { Principal, Role } from "./auth.ts";

export type Org = { id: string; name: string; logoKey: string | null };
export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarKey: string | null;
};

// Thrown when a member tries what only an owner may do.
export class Forbidden extends Error {}

// Locks the org and checks the actor's role from the row itself, not from the
// session's snapshot, so a demotion that lands first is honoured.
async function asOwner<T>(
  p: Principal,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return asOrg(p.orgId, async (q) => {
    await q.query("select 1 from orgs for update");
    const me = await q.query<{ role: Role }>(
      "select role from users where id = $1",
      [p.userId],
    );
    if (me.rows[0]?.role !== "owner")
      throw new Forbidden("Only an owner can do that.");
    return fn(q);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Ids arrive from forms; only the canonical spelling is accepted, so a string
// comparison and a uuid comparison agree.
const canonical = (id: string) => (UUID.test(id) ? id : null);

// The org as the signed-in person sees it: its name and logo, everyone in
// it, and who is invited but not yet arrived.
export async function orgOf(p: Principal): Promise<{
  org: Org;
  members: Member[];
  invited: string[];
}> {
  return asOrg(p.orgId, async (q) => ({
    org: (
      await q.query<Org>('select id, name, logo_key as "logoKey" from orgs')
    ).rows[0]!,
    members: (
      await q.query<Member>(
        'select id, name, email, role, avatar_key as "avatarKey" from users order by role, name',
      )
    ).rows,
    invited: (
      await q.query<{ email: string }>(
        "select email from invitations where accepted_at is null order by created_at",
      )
    ).rows.map((r) => r.email),
  }));
}

export async function renameOrg(p: Principal, name: string): Promise<void> {
  await asOwner(p, (q) => q.query("update orgs set name = $1", [name]));
}

export async function setOrgLogo(p: Principal, key: string): Promise<void> {
  await asOwner(p, (q) => q.query("update orgs set logo_key = $1", [key]));
}

// A person's name and avatar live on people, and every membership carries a
// copy. One transaction holds the person's row while it writes each
// membership inside its own org, so two writes racing cannot leave the orgs
// disagreeing.
async function setProfile(
  p: Principal,
  column: "name" | "avatar_key",
  value: string,
): Promise<void> {
  await asPerson(p.orgId, p.personId, async (q) => {
    const person = (
      await q.query<{ email: string }>(
        "select email from people where id = $1 for update",
        [p.personId],
      )
    ).rows[0];
    if (!person) return;
    await q.query(`update people set ${column} = $1 where id = $2`, [
      value,
      p.personId,
    ]);
    await q.query("select set_config('app.email', $1, true)", [person.email]);
    const orgIds = (
      await q.query<{ org_id: string }>(
        "select org_id from users where email = $1",
        [person.email],
      )
    ).rows.map((r) => r.org_id);
    for (const orgId of orgIds) {
      await q.query("select set_config('app.org_id', $1, true)", [orgId]);
      await q.query(`update users set ${column} = $1 where person_id = $2`, [
        value,
        p.personId,
      ]);
    }
  });
}

export async function renameSelf(p: Principal, name: string): Promise<void> {
  await setProfile(p, "name", name);
}

export async function setAvatar(p: Principal, key: string): Promise<void> {
  await setProfile(p, "avatar_key", key);
}

// Removes a member from the org, ending their sessions and forgetting their
// invitation so they can be invited again. Owners only; a person cannot
// remove themselves, and an org keeps at least one owner. The org row is
// locked so two removals cannot each see the other still there.
export async function removeMember(
  p: Principal,
  userId: string,
): Promise<"removed" | "self" | "last" | "gone"> {
  const id = canonical(userId);
  if (!id) return "gone";
  if (id === p.userId) return "self";
  return asOwner(p, async (q) => {
    const owners = (
      await q.query<{ n: number }>(
        "select count(*)::int as n from users where role = 'owner' and id <> $1",
        [id],
      )
    ).rows[0]!.n;
    if (owners === 0) return "last";
    const gone = await q.query<{ email: string }>(
      "delete from users where id = $1 returning email",
      [id],
    );
    if (gone.rowCount === 0) return "gone";
    await q.query("delete from invitations where email = $1", [
      gone.rows[0]!.email,
    ]);
    return "removed";
  });
}

// Makes a member an owner, or an owner a member. Owners only; an org keeps at
// least one owner.
export async function setRole(
  p: Principal,
  userId: string,
  role: Role,
): Promise<"set" | "last" | "gone"> {
  const id = canonical(userId);
  if (!id) return "gone";
  return asOwner(p, async (q) => {
    if (role === "member") {
      const others = (
        await q.query<{ n: number }>(
          "select count(*)::int as n from users where role = 'owner' and id <> $1",
          [id],
        )
      ).rows[0]!.n;
      if (others === 0) return "last";
    }
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
