import { signOutOthers } from "@maslow/db/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION } from "@/lib/cookie";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Signs the person out everywhere but here: every other browser's and
// phone's session ends, and this one stays. A phone asking for JSON gets
// the count; a browser goes back to the pane.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const here =
    (await cookies()).get(SESSION)?.value ??
    request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const ended = await signOutOthers(p, here);
  if (request.headers.get("accept")?.includes("application/json"))
    return NextResponse.json({ ended });
  return NextResponse.redirect(
    `${origin(request)}/settings?devices=ended`,
    303,
  );
}
