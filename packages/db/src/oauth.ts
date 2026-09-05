import { createHash, randomUUID } from "node:crypto";

import type { Principal } from "./auth.ts";
import { asOrg } from "./index.ts";

// What an app asked for when the person approved it, and must show again to
// trade the code in.
export type Approval = {
  client: string;
  redirectUri: string;
  codeChallenge: string;
};

// How long an approved app has to trade its code in.
const CODE_LIFETIME = "10 minutes";

// Writes down an approval and returns the code the app will bring back: the
// org, then the code, like a session token. The member's stale codes go
// with it.
export async function issueCode(
  p: Principal,
  approval: Approval,
): Promise<string> {
  const id = randomUUID();
  await asOrg(p.orgId, async (q) => {
    await q.query(
      `delete from oauth_codes
       where user_id = $1 and created_at < now() - interval '${CODE_LIFETIME}'`,
      [p.userId],
    );
    await q.query(
      "insert into oauth_codes (id, org_id, user_id, client, redirect_uri, code_challenge) values ($1, $2, $3, $4, $5, $6)",
      [
        id,
        p.orgId,
        p.userId,
        approval.client,
        approval.redirectUri,
        approval.codeChallenge,
      ],
    );
  });
  return `${p.orgId}.${id}`;
}

const CODE = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/;

// PKCE: the challenge is the verifier hashed, as the app said it would be.
const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

// Trades a code for who approved it, once. Null when the code is unknown,
// spent, older than its lifetime, or brought back by a different app, to a
// different address, or without the verifier it was made for.
export async function redeemCode(
  code: string,
  brought: { client: string; redirectUri: string; verifier: string },
): Promise<Principal | null> {
  const parts = code.match(CODE);
  if (!parts) return null;
  const [, orgId, id] = parts;
  const row = await asOrg(orgId!, async (q) =>
    (
      await q.query<{
        client: string;
        redirect_uri: string;
        code_challenge: string;
        user_id: string;
        person_id: string;
        role: Principal["role"];
      }>(
        `delete from oauth_codes c using users u
         where c.id = $1 and u.id = c.user_id
           and c.created_at >= now() - interval '${CODE_LIFETIME}'
         returning c.client, c.redirect_uri, c.code_challenge,
           u.id as user_id, u.person_id, u.role`,
        [id],
      )
    ).rows.at(0),
  );
  if (
    !row ||
    row.client !== brought.client ||
    row.redirect_uri !== brought.redirectUri ||
    row.code_challenge !== challengeOf(brought.verifier)
  )
    return null;
  return {
    personId: row.person_id,
    orgId: orgId!,
    userId: row.user_id,
    role: row.role,
  };
}
