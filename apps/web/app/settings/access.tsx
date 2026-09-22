import { asOrg } from "@maslow/db";
import type { Agent, Principal } from "@maslow/db/auth";
import { computerOf } from "@maslow/db/computers";
import { headers } from "next/headers";

import { Command, Head } from "@/app/computer/making";
import { Button } from "@/components/ui/button";
import { sshKeysOf, sshOf } from "@/lib/computer";
import { deployment } from "@/lib/deployment";

import { Agents } from "./agents";
import { Row, Rows } from "./row";
import { Said } from "./said";
import type { Told } from "./told";

// Every way into the person's computer and brain other than the desktop, in
// one pane: SSH from their own Mac, the agents signed in to their brain,
// and their other browsers and phones. Ports have a page of their own.
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
  const [c, ssh] = await Promise.all([
    d.kind === "none" ? null : asOrg(p.orgId, (q) => computerOf(q, p.userId)),
    d.kind === "none" ? null : sshOf(p, site),
  ]);
  return (
    <div className="flex flex-col gap-6 py-5">
      {ssh && (
        <div className="flex flex-col gap-2">
          <Head>SSH</Head>
          <p className="text-sm text-muted-foreground">
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
                    <Button type="submit" variant="outline" size="xs">
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
      <div className="flex flex-col gap-2">
        <Head>Agents on your database</Head>
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
              variant="outline"
              size="sm"
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
