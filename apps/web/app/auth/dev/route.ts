import { asOrg } from "@placeholder/db";
import { orgs } from "@placeholder/db/seed";

import { deployment } from "@/lib/deployment";
import { origin } from "@/lib/origin";
import { destination, signedIn } from "@/lib/session";

// Vercel gives this request this long: the computer is built behind it.
export const maxDuration = 120;

// Signs in as a seeded person, and returns to the page it was picked from.
// Never in production.
export async function POST(request: Request) {
  if (!deployment.seededSignIn) return new Response(null, { status: 404 });
  const form = await request.formData();
  const userId = form.get("user");
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
    destination(origin(request), form.get("next")),
  );
}
