import { isUuid } from "@placeholder/db";
import { renameSession, sessionOf } from "@placeholder/db/agents";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Gives a conversation the name the person typed: from a form, back to it;
// from the sidebar, a plain 204.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  if (!(await sessionOf(p, id))) return new Response(null, { status: 404 });
  const json = request.headers.get("content-type")?.includes("json");
  const title = String(
    (json
      ? ((await request.json()) as { title?: unknown }).title
      : (await request.formData()).get("title")) ?? "",
  ).trim();
  if (title && title.length <= 120) await renameSession(p, id, title);
  if (json) return new Response(null, { status: 204 });
  return NextResponse.redirect(`${origin(request)}/agent/${id}`, 303);
}
