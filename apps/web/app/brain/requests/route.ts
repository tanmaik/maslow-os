import { Forbidden, Invalid, isId, NotFound } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { after, NextResponse } from "next/server";

import { answerShareAsk } from "@/lib/asks";
import { tellAnswer, tellPublic } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";
import { Refused, told } from "@/lib/shares";

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
    const made = await asPerson(p, (db) => answerShareAsk(db, p, id, intent));
    after(() => told(p, made.files));
    // The door hears of a port made public once the answer has landed.
    if (made.opened) after(() => tellPublic(p));
    const answered = made.notification;
    if (answered) after(() => tellAnswer(p, answered));
  } catch (err) {
    if (
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden ||
      err instanceof Refused
    ) {
      return refused(request, "/brain", err.message);
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${back}`, 303);
}
