import { type NextRequest, NextResponse } from "next/server";

import { cookie, SESSION, SESSION_LIFETIME, SESSION_TOKEN } from "@/lib/cookie";

// Renews a well-formed session cookie on every page visit, so a signed-in
// browser stays signed in for as long as it keeps coming back.
export default function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const token = request.cookies.get(SESSION)?.value;
  if (token && SESSION_TOKEN.test(token))
    response.cookies.set(SESSION, token, cookie(SESSION_LIFETIME));
  return response;
}

// Pages only: the auth routes set the cookie themselves, and files need none.
export const config = { matcher: ["/((?!_next/|auth/|.*\\.).*)"] };
