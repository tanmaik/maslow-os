import type pg from "pg";

import { asOrg } from "./index.ts";

// The phones a person carries Maslow on, by the token Apple's push service
// gave each. A phone registers as the person; the server reads a person's
// phones as the org when it has something to send.

type Query = pg.ClientBase;

export type Phone = { token: string; sandbox: boolean };

// Keeps a phone's token as the person's in this org, one row per org the
// person carries it into, so each org's agent reaches the same phone.
export async function registerPhone(q: Query, p: Phone): Promise<void> {
  await q.query("delete from phones where token = $1", [p.token]);
  await q.query("insert into phones (token, sandbox) values ($1, $2)", [
    p.token,
    p.sandbox,
  ]);
}

// Forgets a phone in one org, as the org: on sign out, for every org the
// person is in, and for a token Apple says no longer reaches anything.
export async function forgetPhone(orgId: string, token: string): Promise<void> {
  await asOrg(orgId, (q) =>
    q.query("delete from phones where token = $1", [token]),
  );
}

// Every phone of one member, for the server to send to.
export async function phonesOf(
  orgId: string,
  userId: string,
): Promise<Phone[]> {
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query<Phone>(
          "select token, sandbox from phones where person_id = $1",
          [userId],
        )
      ).rows,
  );
}
