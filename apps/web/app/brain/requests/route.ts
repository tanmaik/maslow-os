import { Forbidden, Invalid, isId, NotFound } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { after, NextResponse } from "next/server";

import { answerShareAsk } from "@/lib/asks";
import { wakeAnswered, wakeShared } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { refused } from "../refuse";

// Answers an ask the agent made: share as it asked, or not. A port the ask
// names is given on the person's own computer.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const id = String(form.get("request") ?? "");
  if (!isId(id)) return new Response(null, { status: 404 });
  // Back to the page the ask was answered on: the room, or the brain. A
  // refusal is said on the brain either way, since that is the page that
  // holds the asks.
  const back = form.get("back") === "/" ? "/" : "/brain";
  const intent = form.get("intent");
  if (intent !== "accept" && intent !== "decline") {
    return refused(request, "/brain", "An ask is accepted or declined.");
  }
  try {
    const made = await asPerson(p, (db) =>
      answerShareAsk(db, p.userId, id, intent),
    );
    after(() => wakeShared(p, made.shared, made.subjects));
    // The agent that asked hears the answer either way, by the notice
    // that carried the ask.
    if (made.notice) after(() => wakeAnswered(p, made.notice!));
  } catch (err) {
    if (
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden
    ) {
      return refused(request, "/brain", err.message);
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${back}`, 303);
}
