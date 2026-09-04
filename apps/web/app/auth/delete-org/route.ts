import { deleteOrg, Forbidden } from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal, signedOut } from "@/lib/session";

// Deletes the org, once its name has been typed exactly, and ends the
// session with it. The principal only.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const name = (await request.formData()).get("name");
  const home = origin(request);
  try {
    const outcome = await deleteOrg(p, typeof name === "string" ? name : "");
    return outcome === "deleted"
      ? signedOut(home)
      : NextResponse.redirect(`${home}/settings?delete=${outcome}`, 303);
  } catch (err) {
    if (err instanceof Forbidden)
      return new Response(err.message, { status: 403 });
    throw err;
  }
}
