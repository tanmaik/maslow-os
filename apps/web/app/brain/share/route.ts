import {
  Forbidden,
  isId,
  Invalid,
  NotFound,
  share,
  unshare,
  type Access,
  type Target,
} from "@maslow/brain";
import { asPerson, isUuid } from "@maslow/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref } from "../format";
import { subjectFrom } from "../props";
import { refused } from "../refuse";

// What the form is sharing: a record or a type, by id.
function targetFrom(form: FormData): Target | null {
  const record = String(form.get("record") ?? "");
  const type = String(form.get("type") ?? "");
  if (isId(record)) return { record };
  if (isUuid(type)) return { type };
  return null;
}

// Shares a record or a type with a person, a group or everyone at a level,
// or takes a share away. The owner only.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const on = targetFrom(form);
  if (!on) return new Response(null, { status: 404 });
  const back = "record" in on ? recordHref(on.record) : "/brain/vocabulary";
  const subject = subjectFrom(String(form.get("subject") ?? ""));
  if (!subject) {
    return refused(request, back, "A share needs someone to share with.");
  }
  const level = String(form.get("level") ?? "view") as Access;

  try {
    await asPerson(p, async (db) => {
      if (form.get("intent") === "unshare") await unshare(db, on, subject);
      else await share(db, on, subject, level);
    });
  } catch (err) {
    if (
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden
    ) {
      return refused(request, back, err.message);
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${back}`, 303);
}
