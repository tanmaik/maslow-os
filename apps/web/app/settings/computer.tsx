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

import { Row, Rows } from "@/app/settings/row";
import { StatusDot } from "@/components/base/badges/status-dot";
import { SPECS } from "@/lib/trial-computer";
import { READ_ONLY } from "@/lib/trial-rules";

import { on } from "./when";

// The person's computer, as a pane of settings: made for them at sign-in,
// shown as it comes up, and then ready, with its numbers, its size, where
// it is, its backups and reset. Claude Code and the ways in are panes of
// their own.
export async function ComputerPane({ p }: { p: Principal }) {
  if (deployment.trial) return <TrialComputer />;
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
          description="This deployment has no cloud for computers, so nobody gets a computer."
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
        />
      )}
    </div>
  );
}

// The ports other people have opened to this person, each a link to the
// same address its owner hands out. It says nothing when there are none:
// a shared port is knowledge, not a demand.

// A trial's pretend computer, as the pane would show a real one: ready,
// its size and its name, and nothing to change.
function TrialComputer() {
  return (
    <Rows>
      <Row label="Status" description="Pretend, and always ready.">
        <span className="flex items-center gap-2 text-body-regular text-text-secondary">
          <StatusDot color="green" />
          Ready
        </span>
      </Row>
      <Row label="Name">
        <span className="text-body-regular text-text-secondary">
          {SPECS.name}
        </span>
      </Row>
      <Row label="Size">
        <span className="text-body-regular text-text-secondary">
          {SPECS.size}
        </span>
      </Row>
      <Row label="Where">
        <span className="text-body-regular text-text-secondary">
          {SPECS.where}
        </span>
      </Row>
      <Row label="Changes" description={READ_ONLY}>
        <span className="text-body-regular text-text-secondary">None</span>
      </Row>
    </Rows>
  );
}
