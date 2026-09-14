import {
  Forbidden,
  isId,
  Invalid,
  NotFound,
  remove,
  share,
  type Access,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { after, NextResponse } from "next/server";

import { wakeShared } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { subjectFrom } from "../props";
import { backTo, refused } from "../refuse";

// Does to the records chosen in a view what the record page does to one:
// shares them, or removes them. All of them in one transaction, so a set
// the person chose is either done with or untouched.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const back = backTo(form.get("back"), "/brain");
  const ids = form.getAll("record").map(String).filter(isId);
  if (ids.length === 0) {
    return refused(request, back, "Nothing was chosen.");
  }
  const remove_ = form.get("intent") === "remove";
  const subject = remove_ ? null : subjectFrom(String(form.get("subject")));
  if (!remove_ && !subject) {
    return refused(request, back, "A share needs someone to share with.");
  }
  const level = String(form.get("level") ?? "view") as Access;

  try {
    await asPerson(p, async (db) => {
      for (const record of ids) {
        if (remove_) await remove(db, record);
        else await share(db, { record }, subject!, level);
      }
    });
    if (!remove_)
      after(() =>
        wakeShared(
          p,
          ids.map((record) => ({ record })),
          [subject!],
        ),
      );
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
