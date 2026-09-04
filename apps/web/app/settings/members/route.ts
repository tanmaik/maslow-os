import {
  Forbidden,
  removeMember,
  setRole,
  uninvite,
} from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

const roleOutcome = (r: "set" | "last" | "gone", became: string) =>
  r === "set" ? became : r;

// Removes a member, changes a role, or withdraws an invitation. Owners only.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const home = origin(request);
  const back = (outcome: string) =>
    NextResponse.redirect(`${home}/settings?member=${outcome}`, 303);

  try {
    const userId = form.get("remove");
    if (typeof userId === "string") return back(await removeMember(p, userId));
    const promote = form.get("promote");
    if (typeof promote === "string")
      return back(roleOutcome(await setRole(p, promote, "owner"), "owner"));
    const demote = form.get("demote");
    if (typeof demote === "string")
      return back(roleOutcome(await setRole(p, demote, "member"), "member"));
    const email = form.get("uninvite");
    if (typeof email === "string") return back(await uninvite(p, email));
  } catch (err) {
    if (err instanceof Forbidden)
      return new Response(err.message, { status: 403 });
    throw err;
  }
  return new Response(null, { status: 400 });
}
