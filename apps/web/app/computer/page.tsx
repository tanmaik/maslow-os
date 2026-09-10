import { asOrg } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerOf, type SharedPort } from "@maslow/db/computers";
import { groupsOf } from "@maslow/db/groups";
import { orgOf } from "@maslow/db/settings";
import { redirect } from "next/navigation";

import { Making } from "@/app/computer/making";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  modelOf,
  progressOf,
  sharedWithMe,
  sharingOf,
  sshOf,
} from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { sizeOf } from "@/lib/sizes";
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

// The person's computer: made for them at sign-in, shown here as it comes
// up, and then ready.
export default async function ComputerPage() {
  const p = await principal();
  if (!p) redirect("/");
  const off = deployment.computers.kind === "none";
  const c = off ? null : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  return (
    <>
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">Computer</h1>
        {off ? (
          <Alert>
            <AlertTitle>Computers are off here</AlertTitle>
            <AlertDescription>
              This deployment has no Fly token, so nobody gets a computer.
            </AlertDescription>
          </Alert>
        ) : (
          <Making
            at={c ? progressOf(c) : "disk"}
            region={c?.region ?? null}
            size={c ? sizeOf(c) : null}
            backedUp={
              deployment.storage.kind === "s3"
                ? (c?.backedUpAt?.toISOString() ?? null)
                : "off"
            }
            ssh={await sshOf(p)}
            model={modelOf()}
            sharing={await sharing(p)}
          />
        )}
        <Shared ports={await sharedWithMe(p)} />
      </main>
    </>
  );
}

// The ports other people have opened to this person, each a link to the
// same address its owner hands out. It says nothing when there are none:
// a shared port is knowledge, not a demand.
function Shared({ ports }: { ports: SharedPort[] }) {
  if (ports.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Shared with you</p>
      <ul className="text-sm">
        {ports.map((s) => (
          <li key={`${s.machineId}:${s.port}`}>
            <a
              className="underline underline-offset-4"
              href={`/port/${s.machineId}/${s.port}`}
              target="_blank"
              rel="noreferrer"
            >
              {s.owner}&apos;s port {s.port}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
