import { switchTo } from "@placeholder/db/auth";

import { origin } from "@/lib/origin";
import { destination, principal, signedIn } from "@/lib/session";

// Moves the signed-in person into another org they belong to: a new session
// for that membership, the old one left to expire with sign-out. Returns
// where the form said, or home.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const userId = form.get("membership");
  if (typeof userId !== "string") return new Response(null, { status: 400 });
  const there = await switchTo(p, userId);
  if (!there) return new Response("Not one of your orgs.", { status: 403 });
  return signedIn(there, destination(origin(request), form.get("next")));
}
