import { fullName } from "@placeholder/db/auth";
import { orgs } from "@placeholder/db/seed";

import { DevPill } from "@/components/dev-pill";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// What a developer wants at hand on a deployment that is not production:
// where this is, what is faked, who they are, and everyone they could be
// instead. Renders nothing in production.
export async function DevToolbar() {
  if (deployment.production) return null;
  const p = await principal();
  const seeded = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    people: o.users.map((u, i) => ({
      id: u.id,
      name: fullName(u),
      owner: i === 0,
    })),
  }));
  const me = seeded
    .flatMap((o) =>
      o.people.map((u) => ({ id: u.id, name: u.name, org: o.name })),
    )
    .find((u) => u.id === p?.userId);
  return (
    <DevPill
      where={deployment.where}
      faked={[
        deployment.identity.kind === "dev" && "identity",
        deployment.mail.kind === "none" && "mail",
        deployment.storage.kind === "none" && "storage",
      ].filter((f) => f !== false)}
      signedIn={p !== null}
      me={me ?? null}
      orgs={seeded}
      current={p?.userId ?? null}
    />
  );
}
