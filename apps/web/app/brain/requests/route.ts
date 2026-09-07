import {
  acceptRequest,
  declineRequest,
  Forbidden,
  Invalid,
  isId,
  NotFound,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Answers an ask the agent made: share as it asked, or not.
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
      if (intent === "accept") await acceptRequest(db, id);
      else await declineRequest(db, id);
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
  return NextResponse.redirect(`${origin(request)}/brain`, 303);
}
