import { asOrg } from "@maslow/db";
import { pictureInUse } from "@maslow/db/settings";

import { destroy } from "./computer.ts";
import { connections } from "./connections.ts";
import { storage } from "./storage.ts";

// Pays what removals and purges owe the vendors: deletes pictures from
// the store, deletes an ended membership's accounts at Composio, destroys
// a purged member's computer at Fly. Each debt is forgotten only once it
// is paid; one that refuses is tried again by the next call, and the
// sweep calls for every org every hour.
type Orphan = { id: string; kind: string; ref: string };

// Every debt this pays; the database refuses any other kind.
export const KINDS = ["accounts", "picture", "computer"] as const;

export async function settle(orgId: string): Promise<number> {
  const owed = await asOrg(
    orgId,
    async (q) =>
      (
        await q.query<Orphan>(
          "select id, kind, ref from orphans order by created_at",
        )
      ).rows,
  );
  let paid = 0;
  for (const o of owed) {
    // Claimed just before paying: a restore that forgave a debt meanwhile
    // has deleted the row, and the claim finds nothing.
    const claimed = await asOrg(
      orgId,
      async (q) =>
        (
          await q.query("update orphans set tries = tries + 1 where id = $1", [
            o.id,
          ])
        ).rowCount === 1,
    );
    if (!claimed) continue;
    try {
      await pay(orgId, o);
      await asOrg(orgId, (q) =>
        q.query("delete from orphans where id = $1", [o.id]),
      );
      paid++;
    } catch (err) {
      console.error(`orphan ${o.kind} ${o.ref}: ${(err as Error).message}`);
    }
  }
  return paid;
}

async function pay(orgId: string, o: Orphan): Promise<void> {
  switch (o.kind) {
    case "accounts":
      await connections.forgetMember(o.ref);
      return;
    case "picture":
      // A shared picture stays until the last to show it lets it go.
      if (!(await pictureInUse(orgId, o.ref))) await storage.delete(o.ref);
      return;
    case "computer":
      await destroy(orgId, o.ref);
      return;
  }
}
