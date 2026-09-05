import { randomUUID } from "node:crypto";

import { asEmail, asOrg, asSignIn } from "./index.ts";

// What an identity provider vouches for. A last name is optional.
export type Identity = {
  email: string;
  firstName: string;
  lastName: string | null;
};

// A person's name in full.
export const fullName = (p: { firstName: string; lastName: string | null }) =>
  p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;

// The identity behind what a provider offered: its own first and last name
// where given, else its full name cut after the first name, else the
// address's local part as a first name alone.
export function identity(
  email: string,
  given: unknown,
  family: unknown,
  full: unknown,
): Identity {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const words = text(full).split(/\s+/).filter(Boolean);
  const first = text(given) || words[0] || email.split("@")[0]!;
  const rest = text(full).startsWith(first)
    ? text(full).slice(first.length).trim()
    : words.slice(1).join(" ");
  return {
    email: email.toLowerCase(),
    firstName: first,
    lastName: text(family) || rest || null,
  };
}

// Who a request acts as: one person, in one org, through one membership.
export type Role = "owner" | "member";
export type Principal = {
  personId: string;
  orgId: string;
  userId: string;
  role: Role;
};

export type Membership = {
  userId: string;
  orgId: string;
  orgName: string;
  role: Role;
};

// Admits the person an identity provider vouched for. A new email becomes a
// person; every pending invitation becomes a membership; a person with no
// membership at all gets an org of one. Lands in the newest membership.
// Two first sign-ins racing for one email both land on the row the winner made.
export async function signIn(identity: Identity): Promise<Principal> {
  try {
    return await admit(identity);
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
    return admit(identity);
  }
}

async function admit(identity: Identity): Promise<Principal> {
  const email = identity.email.toLowerCase();
  const { person, invitedTo } = await asEmail(email, async (q) => {
    let person = (
      await q.query<{
        id: string;
        firstName: string;
        lastName: string | null;
        avatar_key: string | null;
      }>(
        'select id, first_name as "firstName", last_name as "lastName", avatar_key from people where email = $1',
        [email],
      )
    ).rows[0];
    if (!person) {
      person = {
        id: randomUUID(),
        firstName: identity.firstName,
        lastName: identity.lastName,
        avatar_key: null,
      };
      await q.query(
        "insert into people (id, email, first_name, last_name) values ($1, $2, $3, $4)",
        [person.id, email, person.firstName, person.lastName],
      );
    }
    const invitedTo = (
      await q.query<{ org_id: string }>(
        "select org_id from invitations where email = $1 and accepted_at is null order by created_at",
        [email],
      )
    ).rows.map((r) => r.org_id);
    return { person, invitedTo };
  });

  // Claim each invitation, then join as the person is known today. A past
  // member gets their membership back, with everything they wrote. A
  // withdrawn invitation admits nobody. Under the org lock, like every other
  // change to who is in an org.
  for (const orgId of invitedTo) {
    await asOrg(orgId, async (q) => {
      await q.query("select 1 from orgs for update");
      const claim = await q.query(
        "update invitations set accepted_at = now() where email = $1 and accepted_at is null",
        [email],
      );
      if (!claim.rowCount) return;
      await q.query("select set_config('app.past_members', 'on', true)");
      const back = await q.query(
        "update users set removed_at = null, first_name = $2, last_name = $3, avatar_key = $4 where person_id = $1 and removed_at is not null",
        [person.id, person.firstName, person.lastName, person.avatar_key],
      );
      if (back.rowCount) return;
      await q.query(
        "insert into users (id, org_id, person_id, email, first_name, last_name, avatar_key) values ($1, $2, $3, $4, $5, $6, $7) on conflict (org_id, person_id) do nothing",
        [
          randomUUID(),
          orgId,
          person.id,
          email,
          person.firstName,
          person.lastName,
          person.avatar_key,
        ],
      );
    });
  }

  // Land in the newest membership, or found an org of one. The email is
  // locked while deciding, so sign-ins racing for one email found one org.
  const orgId = randomUUID();
  const userId = randomUUID();
  return asSignIn(email, orgId, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext($1))", [email]);
    const m = (
      await q.query<{ id: string; org_id: string; role: Role }>(
        "select id, org_id, role from users where email = $1 order by created_at desc limit 1",
        [email],
      )
    ).rows[0];
    if (m)
      return {
        personId: person.id,
        orgId: m.org_id,
        userId: m.id,
        role: m.role,
      };
    await q.query(
      "insert into orgs (id, slug, name, principal_id) values ($1, $2, $3, $4)",
      [orgId, orgId, fullName(person), userId],
    );
    await q.query(
      "insert into users (id, org_id, person_id, email, first_name, last_name, avatar_key, role) values ($1, $2, $3, $4, $5, $6, $7, 'owner')",
      [
        userId,
        orgId,
        person.id,
        email,
        person.firstName,
        person.lastName,
        person.avatar_key,
      ],
    );
    return { personId: person.id, orgId, userId, role: "owner" };
  });
}

// Every org the person is in, newest first. Memberships are read as the
// person's email; each org's name is read inside that org, since no scope
// sees every org at once.
export async function membershipsOf(p: Principal): Promise<Membership[]> {
  const email = await emailOf(p);
  if (!email) return [];
  const rows = await asEmail(
    email,
    async (q) =>
      (
        await q.query<{ id: string; org_id: string; role: Role }>(
          "select id, org_id, role from users where email = $1 order by created_at desc",
          [email],
        )
      ).rows,
  );
  return Promise.all(
    rows.map(async (r) => ({
      userId: r.id,
      orgId: r.org_id,
      role: r.role,
      orgName: await asOrg(
        r.org_id,
        async (q) =>
          (await q.query<{ name: string }>("select name from orgs")).rows[0]!
            .name,
      ),
    })),
  );
}

// The email behind the session's membership, or null once that membership
// has been removed.
async function emailOf(p: Principal): Promise<string | null> {
  return asOrg(
    p.orgId,
    async (q) =>
      (
        await q.query<{ email: string }>(
          "select email from users where id = $1",
          [p.userId],
        )
      ).rows[0]?.email ?? null,
  );
}

// The principal for another of the person's memberships, or null if they do
// not hold it.
export async function switchTo(
  p: Principal,
  userId: string,
): Promise<Principal | null> {
  const m = (await membershipsOf(p)).find((m) => m.userId === userId);
  return m
    ? { personId: p.personId, orgId: m.orgId, userId: m.userId, role: m.role }
    : null;
}

// A session and the app holding it, when it is not a browser's.
export type Session = Principal & { client: string | null };

// Opens a session and returns the token its holder will keep, or null if
// the membership is no longer the person's. A browser's session names no
// client; an app connected through OAuth names itself. It lasts until
// deleteSession: signing out is the only way a session ends.
export async function createSession(
  p: Principal,
  client: string | null = null,
): Promise<string | null> {
  const id = randomUUID();
  const opened = await asOrg(p.orgId, (q) =>
    q.query(
      "insert into sessions (id, org_id, user_id, client) select $1, $2, id, $5 from users where id = $3 and person_id = $4",
      [id, p.orgId, p.userId, p.personId, client],
    ),
  );
  return opened.rowCount ? `${p.orgId}.${id}` : null;
}

const TOKEN = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/;

// Finds who a session token belongs to, or null if it is malformed or gone.
export async function resolveSession(
  token: string | undefined,
): Promise<Session | null> {
  const parts = token?.match(TOKEN);
  if (!parts) return null;
  const [, orgId, id] = parts;
  const row = await asOrg(orgId!, async (q) =>
    (
      await q.query<{
        user_id: string;
        person_id: string;
        role: Role;
        client: string | null;
      }>(
        "select s.user_id, s.client, u.person_id, u.role from sessions s join users u on u.id = s.user_id where s.id = $1",
        [id],
      )
    ).rows.at(0),
  );
  return row
    ? {
        personId: row.person_id,
        orgId: orgId!,
        userId: row.user_id,
        role: row.role,
        client: row.client,
      }
    : null;
}

// An app holding a session of the person's, through this membership.
export type Agent = { id: string; client: string; createdAt: Date };

// Every app the person let in through this membership, oldest first.
export async function agentsOf(p: Principal): Promise<Agent[]> {
  return asOrg(
    p.orgId,
    async (q) =>
      (
        await q.query<Agent>(
          'select id, client, created_at as "createdAt" from sessions where user_id = $1 and client is not null order by created_at, id',
          [p.userId],
        )
      ).rows,
  );
}

// Ends one of the person's own app sessions. Whether one ended.
export async function disconnectAgent(
  p: Principal,
  id: string,
): Promise<boolean> {
  const gone = await asOrg(p.orgId, (q) =>
    q.query(
      "delete from sessions where id = $1 and user_id = $2 and client is not null",
      [id, p.userId],
    ),
  );
  return Boolean(gone.rowCount);
}

export async function deleteSession(token: string | undefined): Promise<void> {
  const parts = token?.match(TOKEN);
  if (!parts) return;
  const [, orgId, id] = parts;
  await asOrg(orgId!, (q) =>
    q.query("delete from sessions where id = $1", [id]),
  );
}

export type Invited = "sent" | "pending" | "member";

// Reserves a place in the org for whoever holds this email. An email that
// already belongs to a person is fine; one that is already in this org is
// pointless. Under the org lock, and only if the inviter is still a member.
export async function invite(p: Principal, email: string): Promise<Invited> {
  const address = email.toLowerCase();
  const inserted = await asOrg(p.orgId, async (q) => {
    await q.query("select 1 from orgs for update");
    const still = await q.query("select 1 from users where id = $1", [
      p.userId,
    ]);
    if (!still.rowCount) return null;
    const already = await q.query("select 1 from users where email = $1", [
      address,
    ]);
    if (already.rowCount) return "member" as const;
    return (
      await q.query(
        "insert into invitations (id, org_id, email) values ($1, $2, $3) on conflict (org_id, email) do nothing",
        [randomUUID(), p.orgId, address],
      )
    ).rowCount;
  });
  if (inserted === null || inserted === "member") return "member";
  return inserted ? "sent" : "pending";
}
