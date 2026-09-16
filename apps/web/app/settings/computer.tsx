import { asOrg } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerOf } from "@maslow/db/computers";
import { headers } from "next/headers";

import { Making } from "@/app/computer/making";
import { Notification } from "@/components/base/notification/notification";
import { stateNow, updateOn } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { whereFrom } from "@/lib/region";
import { sizeOf } from "@/lib/sizes";

import { on } from "./when";

// The person's computer, as a pane of settings: made for them at sign-in,
// shown as it comes up, and then ready, with its numbers, its size, where
// it is, its backups and reset. Claude Code and the ways in are panes of
// their own.
export async function ComputerPane({ p }: { p: Principal }) {
  const d = deployment.computers;
  const h = await headers();
  // Everything the pane shows, asked for at once.
  const [c, where] = await Promise.all([
    d.kind === "none" ? null : asOrg(p.orgId, (q) => computerOf(q, p.userId)),
    whereFrom(h),
  ]);
  // Ready is the door answering, so the pane asks it before it draws.
  const state = await stateNow(c);
  return (
    <div className="flex flex-col gap-4">
      {d.kind === "none" ? (
        <Notification
          status="neutral"
          dismissible={false}
          title="Computers are off here"
          description="This deployment has no Fly token, so nobody gets a computer."
        />
      ) : (
        <Making
          state={state}
          door={c?.machineId ? `https://${c.machineId}.${d.domain}` : null}
          where={where}
          since={c?.readyAt ? on(c.readyAt) : null}
          size={c ? sizeOf(c) : null}
          backedUp={
            deployment.storage.kind === "s3"
              ? c?.backedUpAt
                ? on(c.backedUpAt)
                : null
              : "off"
          }
          update={updateOn(c)}
          heartbeat={c?.heartbeatEvery ?? 0}
        />
      )}
    </div>
  );
}

// The ports other people have opened to this person, each a link to the
// same address its owner hands out. It says nothing when there are none:
// a shared port is knowledge, not a demand.
