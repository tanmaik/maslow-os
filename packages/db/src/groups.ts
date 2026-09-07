import type { Principal } from "./auth.ts";
import { asPerson, type Query } from "./index.ts";
import { Forbidden } from "./settings.ts";

// A set of members of the org. Everyone is every current member and is not
// a row: it is listed with the groups and cannot be changed.
export type Group = {
  id: string;
  name: string;
  description: string;
  everyone: boolean;
  members: { id: string; name: string }[];
};

const EVERYONE = "everyone";

// Thrown when a group or member named in a request is no longer in the org.
export class Missing extends Error {}

const missing = (err: unknown) => {
  if ((err as { code?: string }).code === "23503") {
    throw new Missing("Nobody by that id is in the org.");
  }
  throw err;
};

type GroupRow = { id: string; name: string; description: string };
type MemberRow = { group_id: string | null; id: string; name: string };

// The org's groups with their members, Everyone first.
export const groupsOf = (p: Principal): Promise<Group[]> =>
  asPerson(p, groupsIn);

// The same, inside a transaction already running as a person.
export async function groupsIn(q: Query): Promise<Group[]> {
  const groups = await q.query<GroupRow>(
    "select id, name, description from groups order by name",
  );
  const members = await q.query<MemberRow>(
    `select gm.group_id, u.id, u.name from users u
       left join group_members gm on gm.member_id = u.id
       order by u.name`,
  );
  const everyone = new Map(members.rows.map((m) => [m.id, m]));
  return [
    {
      id: EVERYONE,
      name: "Everyone",
      description: "Every current member of the org.",
      everyone: true,
      members: [...everyone.values()].map(({ id, name }) => ({ id, name })),
    },
    ...groups.rows.map((g) => ({
      ...g,
      everyone: false,
      members: members.rows
        .filter((m) => m.group_id === g.id)
        .map(({ id, name }) => ({ id, name })),
    })),
  ];
}

// Refuses unless the actor is an owner of the org.
async function asGroupManager<T>(
  p: Principal,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return asPerson(p, async (q) => {
    const me = await q.query<{ role: string }>(
      "select role from users where id = $1",
      [p.userId],
    );
    if (me.rows[0]?.role !== "owner") {
      throw new Forbidden("Only an owner can manage groups.");
    }
    return fn(q);
  });
}

// Makes a group. Making one that exists returns it.
export async function defineGroup(
  p: Principal,
  name: string,
  description = "",
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80 || trimmed.toLowerCase() === EVERYONE) {
    throw new Forbidden("A group needs a name of up to 80 characters.");
  }
  return asGroupManager(p, async (q) => {
    await q.query(
      `insert into groups (name, description, author) values ($1, $2, $3)
       on conflict (org_id, name) do nothing`,
      [trimmed, description.trim(), `person:${p.userId}`],
    );
    const { rows } = await q.query<{ id: string }>(
      "select id from groups where name = $1",
      [trimmed],
    );
    return rows[0]!.id;
  });
}

// Removes a group. The shares given to it go with it.
export async function deleteGroup(p: Principal, id: string): Promise<void> {
  await asGroupManager(p, (q) =>
    q.query("delete from groups where id = $1", [id]),
  );
}

// Puts a member in a group. Putting them in twice changes nothing.
export async function addToGroup(
  p: Principal,
  groupId: string,
  memberId: string,
): Promise<void> {
  await asGroupManager(p, (q) =>
    q
      .query(
        `insert into group_members (group_id, member_id) values ($1, $2)
         on conflict do nothing`,
        [groupId, memberId],
      )
      .catch(missing),
  );
}

export async function removeFromGroup(
  p: Principal,
  groupId: string,
  memberId: string,
): Promise<void> {
  await asGroupManager(p, (q) =>
    q.query(
      "delete from group_members where group_id = $1 and member_id = $2",
      [groupId, memberId],
    ),
  );
}
