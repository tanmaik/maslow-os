import { foundOrg, personOf } from "@maslow/db/auth";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal, signedIn } from "@/lib/session";

// The longest name an org can have.
const MAX_NAME = 80;

// A second org, or a tenth: a person may found as many as they like, and
// lands in the new one, where their computer is made as at any first
// sign-in. Being in an org already is no bar to having one of your own.
export async function POST(request: Request) {
  const home = origin(request);
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const name = String((await request.formData()).get("name") ?? "").trim();
  // Back to the page the switcher's dialog is on, where a name that will
  // not do is said beside the form.
  if (!name || name.length > MAX_NAME)
    return NextResponse.redirect(`${home}/settings?org=name`, 303);
  const who = await personOf(p);
  if (!who) return new Response(null, { status: 401 });
  return signedIn(await foundOrg(who.person, who.email, name), home, request);
}
