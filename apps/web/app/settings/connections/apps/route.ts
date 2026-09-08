import { NextResponse } from "next/server";

import { connections } from "@/lib/connections";
import { principal } from "@/lib/session";

// The apps that match what the person has typed so far, for the finder on
// the settings page. A vendor that does not answer is a 502, so the finder
// can say so rather than show nothing found.
export async function GET(request: Request) {
  if (!(await principal())) return new Response(null, { status: 401 });
  if (!connections.enabled) return new Response(null, { status: 404 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  try {
    return NextResponse.json(await connections.search(q));
  } catch (err) {
    console.error(`connections: ${(err as Error).message}`);
    return new Response(null, { status: 502 });
  }
}
