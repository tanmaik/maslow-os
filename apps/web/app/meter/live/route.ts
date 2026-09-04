import { NextResponse } from "next/server";

import { live } from "@/lib/meter";
import { principal } from "@/lib/session";

// What the signed-in person is costing right now, for the meter at the
// top of every page.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return NextResponse.json(await live(p), {
    headers: { "cache-control": "no-store" },
  });
}
