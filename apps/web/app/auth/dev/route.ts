import { orgs } from "@placeholder/db/seed";

import { deployment } from "@/lib/deployment";
import { origin } from "@/lib/origin";
import { signedIn } from "@/lib/session";

// Signs in as a seeded person. Never in production.
export async function POST(request: Request) {
  if (!deployment.seededSignIn) return new Response(null, { status: 404 });
  const userId = (await request.formData()).get("user");
  const org = orgs.find((o) => o.users.some((u) => u.id === userId));
  if (!org || typeof userId !== "string")
    return new Response("No such seeded person.", { status: 400 });
  // The seed makes each org's first person its owner.
  const role = org.users[0]?.id === userId ? "owner" : "member";
  return signedIn({ orgId: org.id, userId, role }, origin(request));
}
