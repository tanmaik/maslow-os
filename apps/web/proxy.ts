import { type NextRequest, NextResponse } from "next/server";

import { cookie, SESSION, SESSION_LIFETIME, SESSION_TOKEN } from "@/lib/cookie";
import { origin } from "@/lib/origin";

// Which methods change something. A browser sends the site a request came
// from on every one of them.
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

// Renews a well-formed session cookie on every page visit, so a signed-in
// browser stays signed in for as long as it keeps coming back; and refuses
// anything that would change something at the word of another site. A
// write sets its own cookie or none: signing out ends with the cookie gone.
//
// A page served by a person's computer is framed on someone's screen, and
// its address is a name under ours, which a browser counts as the same site:
// the session cookie is attached to whatever it asks of us. What keeps a
// page from acting as whoever is looking at it is this, not the cookie.
export default function proxy(request: NextRequest) {
  const from = request.headers.get("origin");
  if (!READS.has(request.method) && from && from !== origin(request)) {
    return new NextResponse("That came from somewhere else.", { status: 403 });
  }
  const response = NextResponse.next();
  const token = request.cookies.get(SESSION)?.value;
  if (READS.has(request.method) && token && SESSION_TOKEN.test(token))
    response.cookies.set(SESSION, token, cookie(SESSION_LIFETIME));
  return response;
}

// Everything a browser sends, so nothing that changes something is reached
// without the check; files and the framework's own assets are left alone.
export const config = { matcher: ["/((?!_next/|.*\\.).*)"] };
