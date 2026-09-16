import { NextResponse } from "next/server";

import { landing } from "@/app/settings/connections/landing";
import { connections } from "@/lib/connections";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// A session is opaque, short, and printable.
const SESSION = /^[\x21-\x7e]{1,512}$/;

// Where the browser lands after signing in to an app on a project that
// holds sign-ins until we vouch for them. The signed-in membership is who
// the vendor is told did it; a sign-in begun for someone else fails. A
// connection made lands on the page naming the new account.
export async function GET(request: Request) {
  const home = origin(request);
  const p = await principal();
  if (!p) return NextResponse.redirect(home, 303);
  const session = new URL(request.url).searchParams.get("session_uri") ?? "";
  if (!SESSION.test(session))
    return NextResponse.redirect(landing(home, "gone"), 303);
  try {
    const id = await connections.vouch(p, session);
    return NextResponse.redirect(
      id ? landing(home, "connected", id) : landing(home, "failed"),
      303,
    );
  } catch (err) {
    console.error(`connections: ${(err as Error).message}`);
    return NextResponse.redirect(landing(home, "unanswered"), 303);
  }
}
