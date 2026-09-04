import { randomUUID } from "node:crypto";

import { asEmail, asOrg } from "./index.ts";

// What an identity provider vouches for.
export type Identity = { email: string; name: string };

// Who a request acts as.
export type Principal = { orgId: string; userId: string };

const SESSION_DAYS = 30;

// Admits a person the identity provider vouched for: the one already known by
// that email, else the one an org invited, else a new person in an org of one.
export async function signIn(identity: Identity): Promise<Principal> {
  const found = await asEmail(identity.email, async (q) => {
    const user = await q.query<{ id: string; org_id: string }>(
      "select id, org_id from users where email = $1",
      [identity.email],
    );
    if (user.rows[0]) return { user: user.rows[0], invitedTo: null };
    const invitation = await q.query<{ org_id: string }>(
      "select org_id from invitations where email = $1 and accepted_at is null order by created_at limit 1",
      [identity.email],
    );
    return { user: null, invitedTo: invitation.rows[0]?.org_id ?? null };
  });

  if (found.user) return { orgId: found.user.org_id, userId: found.user.id };

  const userId = randomUUID();
  if (found.invitedTo) {
    const orgId = found.invitedTo;
    await asOrg(orgId, async (q) => {
      await q.query(
        "insert into users (id, org_id, email, name) values ($1, $2, $3, $4)",
        [userId, orgId, identity.email, identity.name],
      );
      await q.query(
        "update invitations set accepted_at = now() where email = $1",
        [identity.email],
      );
    });
    return { orgId, userId };
  }

  const orgId = randomUUID();
  await asOrg(orgId, async (q) => {
    await q.query("insert into orgs (id, slug, name) values ($1, $2, $3)", [
      orgId,
      orgId,
      identity.name,
    ]);
    await q.query(
      "insert into users (id, org_id, email, name) values ($1, $2, $3, $4)",
      [userId, orgId, identity.email, identity.name],
    );
  });
  return { orgId, userId };
}

// Opens a session and returns the token the browser will hold.
export async function createSession(p: Principal): Promise<string> {
  const id = randomUUID();
  await asOrg(p.orgId, (q) =>
    q.query(
      "insert into sessions (id, org_id, user_id, expires_at) values ($1, $2, $3, now() + $4 * interval '1 day')",
      [id, p.orgId, p.userId, SESSION_DAYS],
    ),
  );
  return `${p.orgId}.${id}`;
}

const TOKEN = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/;

// Finds who a session token belongs to, or null if it is malformed, gone or
// expired.
export async function resolveSession(
  token: string | undefined,
): Promise<Principal | null> {
  const parts = token?.match(TOKEN);
  if (!parts) return null;
  const [, orgId, id] = parts;
  const row = await asOrg(orgId!, async (q) =>
    (
      await q.query<{ user_id: string }>(
        "select user_id from sessions where id = $1 and expires_at > now()",
        [id],
      )
    ).rows.at(0),
  );
  return row ? { orgId: orgId!, userId: row.user_id } : null;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  const parts = token?.match(TOKEN);
  if (!parts) return;
  const [, orgId, id] = parts;
  await asOrg(orgId!, (q) =>
    q.query("delete from sessions where id = $1", [id]),
  );
}

// Reserves a place in the org for whoever the identity provider says holds
// this email. Inviting the same email twice is a no-op.
export async function invite(orgId: string, email: string): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query(
      "insert into invitations (id, org_id, email) values ($1, $2, $3) on conflict (org_id, email) do nothing",
      [randomUUID(), orgId, email],
    ),
  );
}
