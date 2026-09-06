import { fullName } from "@placeholder/db/auth";
import { orgs } from "@placeholder/db/seed";

import { DevPill } from "@/components/dev-pill";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// What a developer wants at hand on a deployment that is not production:
// where this is, what is faked, who they are, everyone they could be
// instead, and a way to annotate the page for the agent. Renders nothing
// in production.
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
    <>
      <DevPill
        where={deployment.where}
        vendors={{
          identity: deployment.identity.kind === "workos" ? "WorkOS" : null,
          mail: deployment.mail.kind === "resend" ? "Resend" : null,
          analytics: deployment.analytics.kind === "posthog" ? "PostHog" : null,
          storage: deployment.storage.kind === "s3" ? "S3" : null,
          computers:
            deployment.computers.kind === "fly" &&
            deployment.computers.api === "https://api.machines.dev"
              ? "Fly"
              : null,
          connections:
            deployment.connections.kind === "composio" ? "Composio" : null,
          embeddings: deployment.embeddings.kind === "voyage" ? "Voyage" : null,
        }}
        signedIn={p !== null}
        me={me ?? null}
        orgs={seeded}
        current={p?.userId ?? null}
      />
    </>
  );
}
