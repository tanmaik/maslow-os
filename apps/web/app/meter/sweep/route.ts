import { NextResponse } from "next/server";

import { sweep } from "@/lib/meter";

// The hourly sweep, called by Vercel's cron with the secret it was given.
// Without a secret there is no sweep; it never runs for a stranger.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response(null, { status: 404 });
  const appended = await sweep();
  return NextResponse.json({ appended });
}
