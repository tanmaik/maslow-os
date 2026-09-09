import { renameSelf, setAvatar } from "@maslow/db/settings";
import { NextResponse } from "next/server";

import { sweepMember } from "@/lib/meter";
import { origin } from "@/lib/origin";
import { settle } from "@/lib/orphans";
import { principal } from "@/lib/session";
import { bounded, imageOrThrow, Rejected, storage } from "@/lib/storage";

// Renames the signed-in person and, when a file was chosen, replaces their
// avatar.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  let form: FormData;
  try {
    form = await (await bounded(request, 3 * 1024 * 1024)).formData();
  } catch (err) {
    if (!(err instanceof Rejected)) throw err;
    return new Response(err.message, { status: 413 });
  }
  const home = origin(request);

  const first = form.get("first_name");
  const last = form.get("last_name") ?? "";
  if (
    typeof first !== "string" ||
    !first.trim() ||
    first.length > 80 ||
    typeof last !== "string" ||
    last.length > 80
  )
    return NextResponse.redirect(`${home}/settings?profile=name`, 303);
  await renameSelf(p, first.trim(), last.trim() || null);

  const avatar = form.get("avatar");
  if (avatar instanceof File && avatar.size > 0) {
    let image;
    try {
      image = await imageOrThrow(avatar);
    } catch (err) {
      if (!(err instanceof Rejected)) throw err;
      const why = /object storage/.test(err.message) ? "storage" : "image";
      return NextResponse.redirect(`${home}/settings?profile=${why}`, 303);
    }
    // The photo it replaces is metered to this moment, then owed its
    // deletion, which is paid at once.
    await sweepMember(p.orgId, p.userId);
    const key = await storage.put(image.bytes, image.ext);
    await setAvatar(p, key, image.bytes.length);
    await settle(p.orgId);
  }
  return NextResponse.redirect(`${home}/settings?profile=saved`, 303);
}
