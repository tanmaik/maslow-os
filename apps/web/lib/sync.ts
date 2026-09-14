import { asOrg } from "@maslow/db";
import type { Principal, Role } from "@maslow/db/auth";

import { deployment } from "./deployment";

// The relay calling in the name of a member: the secret the two share, and
// whose membership it acts in, or null when the call is not the relay's or
// the member is not here.
export async function relayCaller(request: Request): Promise<Principal | null> {
  if (deployment.sync.kind === "none") return null;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (bearer !== deployment.sync.secret) return null;
  const userId = request.headers.get("x-maslow-as");
  const orgId = request.headers.get("x-maslow-org");
  if (!userId || !orgId) return null;
  const member = await asOrg(
    orgId,
    async (q) =>
      (
        await q.query<{ person_id: string; role: Role }>(
          "select person_id, role from users where id = $1 and removed_at is null",
          [userId],
        )
      ).rows[0],
  );
  if (!member) return null;
  return { orgId, userId, personId: member.person_id, role: member.role };
}
