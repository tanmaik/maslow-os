import { NextResponse } from "next/server";

import { cleanPath, remove, removeFolder } from "@/lib/files";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Deletes a file (by id) or a folder (by path) with everything in it.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const at = cleanPath(form.get("path") ?? "/") ?? "/";
  const file = form.get("file");
  const folder = cleanPath(form.get("folder"));
  const gone =
    typeof file === "string"
      ? await remove(p, file)
      : folder && folder !== "/"
        ? await removeFolder(p, folder)
        : false;
  return NextResponse.redirect(
    `${origin(request)}/computer?path=${encodeURIComponent(at)}&deleted=${gone ? "yes" : "gone"}`,
    303,
  );
}
