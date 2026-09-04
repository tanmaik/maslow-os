import { NextResponse } from "next/server";

import {
  cleanPath,
  folderExists,
  moveFile,
  moveFolder,
  newFolder,
} from "@/lib/files";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Moves a file (by id) or a folder (by path) into another folder, made
// on the way if it does not exist yet.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const at = cleanPath(form.get("path") ?? "/") ?? "/";
  const to = cleanPath(form.get("to"));
  const back = (outcome: string) =>
    NextResponse.redirect(
      `${origin(request)}/computer?path=${encodeURIComponent(at)}&moved=${outcome}`,
      303,
    );
  if (!to) return back("where");
  if (!(await folderExists(p, to))) await newFolder(p, to);
  const file = form.get("file");
  if (typeof file === "string")
    return back((await moveFile(p, file, to)) ? "yes" : "gone");
  const folder = cleanPath(form.get("folder"));
  if (folder && folder !== "/") {
    if (to === folder || to.startsWith(`${folder}/`)) return back("inside");
    const dest = `${to === "/" ? "" : to}${folder.slice(folder.lastIndexOf("/"))}`;
    return back((await moveFolder(p, folder, dest)) ? "yes" : "gone");
  }
  return back("where");
}
