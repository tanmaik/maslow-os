import { asOrg } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerOf, type SharedPort } from "@maslow/db/computers";
import { groupsOf } from "@maslow/db/groups";
import { orgOf } from "@maslow/db/settings";
import { headers } from "next/headers";

import { Making } from "@/app/computer/making";
import { ButtonLink } from "@/components/base/buttons/button";
import { Notification } from "@/components/base/notification/notification";
import {
  modelOf,
  sharedWithMe,
  sharingOf,
  sshOf,
  stateNow,
  updateOn,
  usageOf,
} from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { dayOf, dollars } from "@/lib/dollars";
import { whereFrom } from "@/lib/region";
import { sizeOf } from "@/lib/sizes";

import { Row, Rows } from "./row";
import type { Told } from "./told";
import { on } from "./when";

// What the ports list needs to share one: the machine an address names,
// the groups and people a port can be given to, and who each already
// reaches. Everyone in the org is a choice of its own and not a group, so
// the group Everyone is left out of the list. Null until the computer is
// ready, since there is nothing to share yet.
async function sharing(p: Principal) {
  const mine = await sharingOf(p);
  if (!mine) return null;
  const [{ members }, groups] = await Promise.all([orgOf(p), groupsOf(p)]);
  return {
    ...mine,
    members: members
      .filter((m) => m.id !== p.userId)
      .map((m) => ({ id: m.id, name: m.name })),
    groups: groups
      .filter((g) => !g.everyone)
      .map((g) => ({ id: g.id, name: g.name })),
  };
}

// The person's computer, as a pane of settings: made for them at sign-in,
// shown as it comes up, and then ready, with its numbers, its ports, its
// size, where it is, its backups, SSH, Claude Code and reset, and the
// ports others opened to them.
export async function ComputerPane({
  p,
  said,
}: {
  p: Principal;
  // What the last save of the public key left to say.
  said: Told;
}) {
  const d = deployment.computers;
  const h = await headers();
  // This site as the browser reached it, for the command the person runs.
  const site = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  // Everything the pane shows, asked for at once.
  const [c, where, ssh, shares, shared, usage] = await Promise.all([
    d.kind === "none" ? null : asOrg(p.orgId, (q) => computerOf(q, p.userId)),
    whereFrom(h),
    sshOf(p, site),
    sharing(p),
    sharedWithMe(p),
    usageOf(p),
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
          ssh={ssh}
          keys={c?.authorizedKeys ?? ""}
          said={said}
          update={updateOn(c)}
          model={modelOf()}
          heartbeat={c?.heartbeatEvery ?? 0}
          sharing={shares}
        />
      )}
      {usage && (
        <Rows>
          <Row
            label="Models"
            description={
              usage.spentUsd >= usage.capUsd
                ? `Weekly limit reached, resets ${dayOf(usage.resetsAt)}.`
                : `What Claude Code on your computer has spent this week.`
            }
          >
            <ButtonLink
              variant="secondary"
              size="xs"
              href="/settings?pane=usage"
            >
              {dollars(usage.spentUsd)} of {dollars(usage.capUsd)} this week
            </ButtonLink>
          </Row>
        </Rows>
      )}
      <Shared ports={shared} />
    </div>
  );
}

// The ports other people have opened to this person, each a link to the
// same address its owner hands out. It says nothing when there are none:
// a shared port is knowledge, not a demand.
function Shared({ ports }: { ports: SharedPort[] }) {
  if (ports.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-body-2-medium text-text-secondary">
        Shared with you
      </p>
      <Rows>
        {ports.map((s) => (
          <Row
            key={`${s.machineId}:${s.port}`}
            label={`${s.owner}'s port ${s.port}`}
          >
            <ButtonLink
              variant="secondary"
              size="xs"
              href={`/port/${s.machineId}/${s.port}`}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </ButtonLink>
          </Row>
        ))}
      </Rows>
    </div>
  );
}
