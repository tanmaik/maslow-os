import type { Principal } from "@maslow/db/auth";
import { groupsOf } from "@maslow/db/groups";
import { orgOf } from "@maslow/db/settings";
import { redirect } from "next/navigation";

import { LivePorts } from "@/app/computer/ports/live-ports";
import { Shared } from "@/app/computer/ports/shared";
import { ComputerWaiting } from "@/components/computer-waiting";
import { publishedOf, sharedWithMe, sharingOf } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

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

// Ports: every port listening on the person's computer,
// each opened, shared, or made an app, which puts it in the sidebar
// under the name and face given it; and the ports colleagues opened to
// them.
export default async function PortsPage() {
  const p = await principal();
  if (!p) redirect("/");
  const off = deployment.computers.kind === "none";
  const [shares, shared, published] = off
    ? [null, [], []]
    : await Promise.all([sharing(p), sharedWithMe(p), publishedOf(p)]);
  return (
    <main className="flex flex-col gap-4">
      <h1 className="page-title text-lg font-medium text-foreground">Ports</h1>
      {off ? (
        <ComputerWaiting
          title="Computers are off here"
          description="This deployment has no cloud for computers, so there are no ports to show."
        />
      ) : (
        <div className="flex flex-col gap-5 [html[data-framed]_&]:p-3">
          <LivePorts sharing={shares} published={published} />
          <Shared ports={shared} />
        </div>
      )}
    </main>
  );
}
