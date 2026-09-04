import { randomUUID } from "node:crypto";

import { asEmail, asOrg } from "./index.ts";

// What an identity provider vouches for.
export type Identity = { email: string; name: string };

// Who a request acts as.
export type Role = "owner" | "member";
export type Principal = { orgId: string; userId: string; role: Role };

// Admits a person the identity provider vouched for: the one already known by
// that email, else the one an org invited, else a new person in an org of one.
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
  const found = await asEmail(identity.email, async (q) => {
    const user = await q.query<{ id: string; org_id: string; role: Role }>(
      "select id, org_id, role from users where email = $1",
      [identity.email],
    );
    if (user.rows[0]) return { user: user.rows[0], invitedTo: null };
    const invitation = await q.query<{ org_id: string }>(
      "select org_id from invitations where email = $1 and accepted_at is null order by created_at limit 1",
      [identity.email],
    );
    return { user: null, invitedTo: invitation.rows[0]?.org_id ?? null };
  });

  if (found.user)
    return {
      orgId: found.user.org_id,
      userId: found.user.id,
      role: found.user.role,
    };

  const userId = randomUUID();
  if (found.invitedTo) {
    const orgId = found.invitedTo;
    // The invitation is claimed first; withdrawn in the meantime means no
    // admission, and sign-in starts over as uninvited.
    const claimed = await asOrg(orgId, async (q) => {
      const claim = await q.query(
        "update invitations set accepted_at = now() where email = $1 and accepted_at is null",
        [identity.email],
      );
      if (!claim.rowCount) return false;
      await q.query(
        "insert into users (id, org_id, email, name) values ($1, $2, $3, $4)",
        [userId, orgId, identity.email, identity.name],
      );
      return true;
    });
    if (claimed) return { orgId, userId, role: "member" };
    return admit(identity);
  }

  const orgId = randomUUID();
  await asOrg(orgId, async (q) => {
    await q.query("insert into orgs (id, slug, name) values ($1, $2, $3)", [
      orgId,
      orgId,
      identity.name,
    ]);
    await q.query(
      "insert into users (id, org_id, email, name, role) values ($1, $2, $3, $4, 'owner')",
      [userId, orgId, identity.email, identity.name],
    );
  });
  return { orgId, userId, role: "owner" };
}

// Opens a session and returns the token the browser will hold. It lasts until
// deleteSession: signing out is the only way a session ends.
export async function createSession(p: Principal): Promise<string> {
  const id = randomUUID();
  await asOrg(p.orgId, (q) =>
    q.query("insert into sessions (id, org_id, user_id) values ($1, $2, $3)", [
      id,
      p.orgId,
      p.userId,
    ]),
  );
  return `${p.orgId}.${id}`;
}

const TOKEN = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/;

// Finds who a session token belongs to, or null if it is malformed or gone.
export async function resolveSession(
  token: string | undefined,
): Promise<Principal | null> {
  const parts = token?.match(TOKEN);
  if (!parts) return null;
  const [, orgId, id] = parts;
  const row = await asOrg(orgId!, async (q) =>
    (
      await q.query<{ user_id: string; role: Role }>(
        "select s.user_id, u.role from sessions s join users u on u.id = s.user_id where s.id = $1",
        [id],
      )
    ).rows.at(0),
  );
  return row ? { orgId: orgId!, userId: row.user_id, role: row.role } : null;
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

// Reserves a place in the org for whoever the identity provider says holds
// this email. Says whether that is new, already pending, or pointless because
// the email already belongs to someone.
export async function invite(p: Principal, email: string): Promise<Invited> {
  const taken = await asEmail(
    email,
    async (q) =>
      (await q.query("select 1 from users where email = $1", [email])).rowCount,
  );
  if (taken) return "member";
  // Under the org lock, and only if the inviter is still in the org.
  const inserted = await asOrg(p.orgId, async (q) => {
    await q.query("select 1 from orgs for update");
    const still = await q.query("select 1 from users where id = $1", [
      p.userId,
    ]);
    if (!still.rowCount) return null;
    return (
      await q.query(
        "insert into invitations (id, org_id, email) values ($1, $2, $3) on conflict (org_id, email) do nothing",
        [randomUUID(), p.orgId, email],
      )
    ).rowCount;
  });
  if (inserted === null) return "member";
  return inserted ? "sent" : "pending";
}
