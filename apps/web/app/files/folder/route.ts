import { NextResponse } from "next/server";

import { cleanName, cleanPath, newFolder } from "@/lib/files";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Makes a folder inside the one the person is looking at.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const at = cleanPath(form.get("path") ?? "/");
  const name = cleanName(form.get("name"));
  const back = (outcome: string) =>
    NextResponse.redirect(
      `${origin(request)}/computer?path=${encodeURIComponent(at ?? "/")}&folder=${outcome}`,
      303,
    );
  if (!at || !name) return back("name");
  await newFolder(p, at === "/" ? `/${name}` : `${at}/${name}`);
  return back("made");
}
