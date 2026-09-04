import { asOrg } from "@placeholder/db";
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
  const live = await asOrg(
    org.id,
    async (q) =>
      (
        await q.query<{ role: "owner" | "member" }>(
          "select role from users where id = $1",
          [userId],
        )
      ).rows[0],
  );
  if (!live)
    return new Response("That person was removed from the org.", {
      status: 400,
    });
  const u = org.users.find((u) => u.id === userId)!;
  return signedIn(
    { personId: u.personId, orgId: org.id, userId, role: live.role },
    origin(request),
  );
}
