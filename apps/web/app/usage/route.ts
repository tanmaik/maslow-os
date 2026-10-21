import { NextResponse } from "next/server";

import { usageOf } from "@/lib/computer";
import { principal } from "@/lib/session";

// What the signed-in person has spent on models, in dollars: the number
// the Agent window's card and the Usage pane read. A deployment that mints
// no model keys has none to answer, and says so with a 404 rather than a
// figure nobody spent.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const usage = await usageOf(p);
  if (!usage) return new Response(null, { status: 404 });
  return NextResponse.json(usage, {
    headers: { "cache-control": "no-store" },
  });
}
