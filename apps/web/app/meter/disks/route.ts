import { NextResponse } from "next/server";

import { growNow } from "@/lib/computer";

// Vercel gives this request this long.
export const maxDuration = 300;

// Every ten minutes, called by Vercel's cron with the secret it was given:
// every disk that is nearly full is grown now, not at the hour's sweep. A
// machine can fill in the minutes a checkout and its build take; an hour
// is too long to sit at no room. Without a secret there is no call; it
// never runs for a stranger.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response(null, { status: 404 });
  const grown = await growNow();
  return NextResponse.json({ grown });
}
