import { renameSelf, setAvatar } from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
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
    await setAvatar(p, await storage.put(image.bytes, image.ext));
  }
  return NextResponse.redirect(`${home}/settings?profile=saved`, 303);
}
