import { NextResponse } from "next/server";

import {
  cleanName,
  cleanPath,
  moveFolder,
  parentOf,
  renameFile,
} from "@/lib/files";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Renames a file (by id) or a folder (by path) in place.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const at = cleanPath(form.get("path") ?? "/") ?? "/";
  const name = cleanName(form.get("name"));
  const back = (outcome: string) =>
    NextResponse.redirect(
      `${origin(request)}/computer?path=${encodeURIComponent(at)}&renamed=${outcome}`,
      303,
    );
  if (!name) return back("name");
  const file = form.get("file");
  if (typeof file === "string")
    return back((await renameFile(p, file, name)) ? "yes" : "gone");
  const folder = cleanPath(form.get("folder"));
  if (folder && folder !== "/") {
    const to = `${parentOf(folder) === "/" ? "" : parentOf(folder)}/${name}`;
    return back((await moveFolder(p, folder, to)) ? "yes" : "gone");
  }
  return back("name");
}
