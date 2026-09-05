import {
  Forbidden,
  Invalid,
  NotFound,
  share,
  unshare,
  type Access,
  type Subject,
} from "@placeholder/brain";
import { asPerson, isUuid } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref } from "../../../format";

// A subject as the form names it: "everyone", "group:<id>" or "member:<id>".
function subjectFrom(value: string): Subject | null {
  if (value === "everyone") return { kind: "everyone" };
  const [kind, id] = value.split(":");
  if ((kind === "group" || kind === "member") && id && isUuid(id)) {
    return { kind, id };
  }
  return null;
}

// Shares a record with a person, a group or everyone at a level, or takes a
// share away. The record's owner only.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const form = await request.formData();
  const subject = subjectFrom(String(form.get("subject") ?? ""));
  if (!subject) {
    return new Response("Choose who to share with.", { status: 400 });
  }
  const level = String(form.get("level") ?? "view") as Access;

  try {
    await asPerson(p, async (db) => {
      if (form.get("intent") === "unshare") await unshare(db, id, subject);
      else await share(db, `person:${p.userId}`, id, subject, level);
    });
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return new Response(err.message, { status: 400 });
    }
    if (err instanceof Forbidden) {
      return new Response(err.message, { status: 403 });
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${recordHref(id)}`, 303);
}
