import { isUuid } from "@placeholder/db";
import {
  addToGroup,
  defineGroup,
  deleteGroup,
  Missing,
  removeFromGroup,
} from "@placeholder/db/groups";
import { Forbidden } from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Makes or deletes a group, or puts a member in or out of one. Owners only.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const id = (k: string) => (isUuid(text(k)) ? text(k) : null);
  const back = (outcome: string) =>
    NextResponse.redirect(`${origin(request)}/settings?group=${outcome}`, 303);

  try {
    switch (text("intent")) {
      case "define":
        await defineGroup(p, text("name"), text("description"));
        return back("saved");
      case "delete": {
        const group = id("group");
        if (!group) return back("gone");
        await deleteGroup(p, group);
        return back("deleted");
      }
      case "add": {
        const group = id("group");
        const member = id("member");
        if (!group || !member) return back("gone");
        await addToGroup(p, group, member);
        return back("saved");
      }
      case "remove": {
        const group = id("group");
        const member = id("member");
        if (!group || !member) return back("gone");
        await removeFromGroup(p, group, member);
        return back("saved");
      }
    }
  } catch (err) {
    if (err instanceof Missing) return back("gone");
    if (err instanceof Forbidden)
      return new Response(err.message, { status: 403 });
    throw err;
  }
  return new Response(null, { status: 400 });
}
