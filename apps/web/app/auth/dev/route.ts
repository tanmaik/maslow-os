import { orgs } from "@placeholder/db/seed";

import { deployment } from "../../../lib/deployment.ts";
import { origin } from "../../../lib/oidc.ts";
import { signedIn } from "../../../lib/session.ts";

// Signs in as a seeded person. Exists only while no identity provider is
// configured, which production never allows.
export async function POST(request: Request) {
  if (deployment.identity.kind !== "dev")
    return new Response(null, { status: 404 });
  const userId = (await request.formData()).get("user");
  const org = orgs.find((o) => o.users.some((u) => u.id === userId));
  if (!org || typeof userId !== "string")
    return new Response("No such seeded person.", { status: 400 });
  return signedIn({ orgId: org.id, userId }, origin(request));
}
