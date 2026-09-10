import {
  acceptRequest,
  declineRequest,
  Forbidden,
  Invalid,
  isId,
  NotFound,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { computerOf, givePort } from "@maslow/db/computers";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Answers an ask the agent made: share as it asked, or not. A port the ask
// names is given on the person's own computer.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const id = String(form.get("request") ?? "");
  if (!isId(id)) return new Response(null, { status: 404 });
  const intent = form.get("intent");
  if (intent !== "accept" && intent !== "decline") {
    return new Response("Share, or not now.", { status: 400 });
  }
  try {
    await asPerson(p, async (db) => {
      if (intent !== "accept") return declineRequest(db, id);
      await acceptRequest(db, id, async (port, to) => {
        const c = await computerOf(db, p.userId);
        if (!c) throw new Invalid("you have no computer to give a port of");
        await givePort(db, c.id, port, to);
      });
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
  // Back to the page the ask was answered on: the room, or the brain.
  const back = form.get("back") === "/" ? "/" : "/brain";
  return NextResponse.redirect(`${origin(request)}${back}`, 303);
}
