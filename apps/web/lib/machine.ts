import { asOrg } from "@placeholder/db";
import type { Session } from "@placeholder/db/auth";
import { computerByMachine } from "@placeholder/db/backups";

// The machine's word for who it is, on a request to one of the app's doors:
// its id and secret as one bearer token, as Claude Code sends a credential,
// or as two headers. Null when the request carries neither.
export function machineFrom(
  request: Request,
): { machineId: string; secret: string } | null {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const dot = bearer?.indexOf(".") ?? -1;
  if (bearer && dot > 0)
    return { machineId: bearer.slice(0, dot), secret: bearer.slice(dot + 1) };
  const secret = request.headers.get("x-computer-secret");
  const machineId = request.headers.get("fly-machine-id");
  return secret && machineId ? { machineId, secret } : null;
}

// The person a machine acts for: the one it belongs to. The brain's door
// takes this as it takes a session. Null for a stranger.
export async function personBehindMachine(
  machineId: string,
  secret: string,
): Promise<Session | null> {
  const c = await computerByMachine(machineId, secret);
  if (!c) return null;
  const u = await asOrg(
    c.orgId,
    async (q) =>
      (
        await q.query<{ personId: string; role: "owner" | "member" }>(
          'select person_id as "personId", role from users where id = $1',
          [c.userId],
        )
      ).rows[0],
  );
  return u
    ? {
        personId: u.personId,
        orgId: c.orgId,
        userId: c.userId,
        role: u.role,
        client: "your agent",
      }
    : null;
}
