import { NextResponse } from "next/server";

import { connections } from "@/lib/connections";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// A session is opaque, short, and printable.
const SESSION = /^[\x21-\x7e]{1,512}$/;

// Where the browser lands after signing in to an app on a project that
// holds sign-ins until we vouch for them. The signed-in membership is who
// the vendor is told did it; a sign-in begun for someone else fails.
export async function GET(request: Request) {
  const home = origin(request);
  const p = await principal();
  if (!p) return NextResponse.redirect(home, 303);
  const session = new URL(request.url).searchParams.get("session_uri") ?? "";
  const outcome = SESSION.test(session)
    ? await connections.vouch(p, session).catch((err: Error) => {
        console.error(`connections: ${err.message}`);
        return "unanswered";
      })
    : "gone";
  return NextResponse.redirect(`${home}/settings?connection=${outcome}`, 303);
}
