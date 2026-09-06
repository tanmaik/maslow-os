import { NextResponse } from "next/server";

import { sweepNow } from "@/lib/meter";

// Vercel gives this request this long.
export const maxDuration = 300;

// The hourly sweep, called by Vercel's cron with the secret it was given:
// the backstop for hours nobody looks at their computer. Without a secret
// there is no sweep; it never runs for a stranger. It takes the same lock
// a page look does, so the cron and a page never sweep at once.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response(null, { status: 404 });
  const appended = await sweepNow();
  return NextResponse.json({ appended });
}
