import { asOrg } from "@maslow/db";
import type { Agent, Principal } from "@maslow/db/auth";
import { computerOf, type SharedPort } from "@maslow/db/computers";
import { groupsOf } from "@maslow/db/groups";
import { orgOf } from "@maslow/db/settings";
import { headers } from "next/headers";

import { Command, Head } from "@/app/computer/making";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import {
  publishedOf,
  sharedWithMe,
  sharingOf,
  sshKeysOf,
  sshOf,
} from "@/lib/computer";
import { deployment } from "@/lib/deployment";

import { Agents } from "./agents";
import { LivePorts } from "./live-ports";
import { Row, Rows } from "./row";
import { Said } from "./said";
import type { Told } from "./told";

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

// The ports others opened to this person, each a window a click away.
function Shared({ ports }: { ports: SharedPort[] }) {
  if (ports.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-caption-1-medium text-text-secondary">
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

// Every way into the person's computer and brain other than the desktop, in
// one pane: SSH from their own Mac, the ports they have opened and who
// each reaches, the ports others opened to them, and the agents signed in
// to their brain.
export async function AccessPane({
  p,
  agents,
  devices,
  saidKeys,
  saidAgent,
  saidDevices,
}: {
  p: Principal;
  agents: Agent[];
  devices: number;
  saidKeys: Told;
  saidAgent: Told;
  saidDevices: Told;
}) {
  const d = deployment.computers;
  const h = await headers();
  const site = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const [c, ssh, shares, shared, published] = await Promise.all([
    d.kind === "none" ? null : asOrg(p.orgId, (q) => computerOf(q, p.userId)),
    d.kind === "none" ? null : sshOf(p, site),
    d.kind === "none" ? null : sharing(p),
    d.kind === "none" ? [] : sharedWithMe(p),
    publishedOf(p),
  ]);
  return (
    <div className="flex flex-col gap-5">
      {ssh && (
        <div className="flex flex-col gap-2">
          <Head>SSH</Head>
          <p className="px-3 text-body-regular text-text-secondary">
            Run once on a Mac, then <code>ssh {ssh.name}</code>.
          </p>
          <Command text={ssh.command} />
          {/* The Macs that can get in, each by the name its key carries. */}
          {c && c.authorizedKeys !== "" && (
            <Rows>
              {sshKeysOf(c.authorizedKeys).map((k) => (
                <Row
                  key={k.fingerprint}
                  label={k.name}
                  description={k.fingerprint}
                >
                  <form action="/settings/keys" method="post">
                    <input type="hidden" name="remove" value={k.fingerprint} />
                    <Button type="submit" variant="secondary" size="xs">
                      Remove
                    </Button>
                  </form>
                </Row>
              ))}
            </Rows>
          )}
          <Said {...saidKeys} />
        </div>
      )}
      {d.kind !== "none" && (
        <LivePorts sharing={shares} published={published} />
      )}
      <Shared ports={shared} />
      <div className="flex flex-col gap-2">
        <Head>Agents on your brain</Head>
        <Agents agents={agents} said={saidAgent} />
      </div>
      <form
        action="/settings/devices"
        method="post"
        className="flex flex-col gap-2"
      >
        <Head>Browsers and phones</Head>
        <Rows>
          <Row
            label={
              devices === 1
                ? "Signed in here and nowhere else"
                : `Signed in on ${devices} browsers and phones, this one included`
            }
            description="A lost phone or a forgotten browser stays signed in until you end it here."
          >
            <Button
              variant="secondary"
              size="small"
              type="submit"
              disabled={devices <= 1}
            >
              Sign out the others
            </Button>
          </Row>
        </Rows>
        <Said {...saidDevices} />
      </form>
    </div>
  );
}
