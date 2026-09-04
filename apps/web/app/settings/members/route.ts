import {
  canPurge,
  Forbidden,
  handOver,
  purgeMember,
  removeMember,
  restoreMember,
  setRole,
  uninvite,
} from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { sweepMember } from "@/lib/meter";
import { settle } from "@/lib/orphans";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

const roleOutcome = (r: "set" | "principal" | "gone", became: string) =>
  r === "set" ? became : r;

// Removes a member, brings a past member back or purges them, changes a
// role, hands the org over, or withdraws an invitation. Owners only.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const home = origin(request);
  const back = (outcome: string) =>
    NextResponse.redirect(`${home}/settings?member=${outcome}`, 303);

  try {
    const userId = form.get("remove");
    // A removal owes their compute a stop; a purge owes everything of
    // theirs the vendors hold. Both are written with the rows, under the
    // owner's lock, and paid right after; the sweep pays what refused.
    if (typeof userId === "string") {
      const outcome = await removeMember(p, userId);
      if (outcome === "removed") await settle(p.orgId);
      return back(outcome);
    }
    const restore = form.get("restore");
    if (typeof restore === "string")
      return back(await restoreMember(p, restore));
    const purge = form.get("purge");
    // Nothing of theirs is destroyed until the owner and the past
    // membership are checked; what they cost until now is written first.
    if (typeof purge === "string") {
      if (!(await canPurge(p, purge))) return back("gone");
      await sweepMember(p.orgId, purge);
      const outcome = await purgeMember(p, purge);
      if (outcome === "purged") await settle(p.orgId);
      return back(outcome);
    }
    const handover = form.get("handover");
    if (typeof handover === "string") return back(await handOver(p, handover));
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
