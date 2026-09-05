import { asOrg } from "@placeholder/db";

import { connections } from "./connections.ts";
import { deployment } from "./deployment.ts";
import { dropBytes } from "./files.ts";
import { fly } from "./fly.ts";
import { s3 } from "./s3.ts";

// Pays what removals and purges owe the vendors: stops or destroys
// machines, destroys volumes, deletes objects and unfinished uploads,
// deletes an ended membership's accounts at Composio. Each
// debt is forgotten only once it is paid; one that refuses is tried again
// by the next call, and the sweep calls for every org every hour.
type Orphan = { id: string; kind: string; ref: string; extra: string | null };

export async function settle(orgId: string): Promise<number> {
  const owed = await asOrg(
    orgId,
    async (q) =>
      (
        await q.query<Orphan>(
          "select id, kind, ref, extra from orphans order by created_at",
        )
      ).rows,
  );
  let paid = 0;
  for (const o of owed) {
    // Claimed just before paying: a restore that forgave a stop meanwhile
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
      await pay(o);
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

async function pay(o: Orphan): Promise<void> {
  const st = deployment.storage;
  switch (o.kind) {
    case "stop":
      if (deployment.computers.kind === "none") return;
      if (await fly.machine(o.ref)) await fly.stop(o.ref);
      return;
    case "machine":
      if (deployment.computers.kind === "none") return;
      await fly.destroyMachine(o.ref);
      return;
    case "volume":
      if (deployment.computers.kind === "none") return;
      await fly.destroyVolume(o.ref);
      return;
    case "accounts":
      await connections.forgetMember(o.ref);
      return;
    case "object":
    case "upload": {
      if (st.kind === "s3") {
        const r =
          o.kind === "upload" && o.extra
            ? await s3(st, "DELETE", o.ref, undefined, undefined, {
                uploadId: o.extra,
              })
            : await s3(st, "DELETE", o.ref);
        if (!r.ok && r.status !== 404)
          throw new Error(`storage delete → ${r.status}`);
      } else if (st.kind === "local") {
        await dropBytes({
          key: o.ref,
          state: o.kind === "upload" ? "uploading" : "ready",
          uploadId: o.extra,
        });
      }
      return;
    }
  }
}
