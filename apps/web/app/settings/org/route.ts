import { Forbidden, renameOrg, setOrgLogo } from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";
import { bounded, imageOrThrow, Rejected, storage } from "@/lib/storage";

// Renames the org and, when a file was chosen, replaces its logo.
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

  const name = form.get("name");
  if (typeof name !== "string" || !name.trim() || name.length > 80)
    return NextResponse.redirect(`${home}/settings?org=name`, 303);
  try {
    await renameOrg(p, name.trim());
  } catch (err) {
    if (err instanceof Forbidden)
      return new Response(err.message, { status: 403 });
    throw err;
  }

  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    let image;
    try {
      image = await imageOrThrow(logo);
    } catch (err) {
      if (!(err instanceof Rejected)) throw err;
      const why = /object storage/.test(err.message) ? "storage" : "image";
      return NextResponse.redirect(`${home}/settings?org=${why}`, 303);
    }
    await setOrgLogo(p, await storage.put(image.bytes, image.ext));
  }
  return NextResponse.redirect(`${home}/settings?org=saved`, 303);
}
