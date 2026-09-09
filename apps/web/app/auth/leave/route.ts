import { leaveOrg } from "@maslow/db/settings";
import { NextResponse } from "next/server";

import { settle } from "@/lib/orphans";
import { origin } from "@/lib/origin";
import { principal, signedOut } from "@/lib/session";

// Leaves the org and ends the session. The principal is sent back to hand
// the org over first.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const home = origin(request);
  const outcome = await leaveOrg(p);
  if (outcome === "left") await settle(p.orgId);
  return outcome === "left"
    ? signedOut(home)
    : NextResponse.redirect(`${home}/settings?leave=${outcome}`, 303);
}
