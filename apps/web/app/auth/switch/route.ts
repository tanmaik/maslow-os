import { switchTo } from "@placeholder/db/auth";

import { origin } from "@/lib/origin";
import { principal, signedIn } from "@/lib/session";

// Moves the signed-in person into another org they belong to: a new session
// for that membership, the old one left to expire with sign-out.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const userId = (await request.formData()).get("membership");
  if (typeof userId !== "string") return new Response(null, { status: 400 });
  const next = await switchTo(p, userId);
  if (!next) return new Response("Not one of your orgs.", { status: 403 });
  return signedIn(next, origin(request));
}
