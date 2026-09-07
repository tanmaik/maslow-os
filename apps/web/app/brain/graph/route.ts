import { graph } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { principal } from "@/lib/session";

// The graph of everything this person can see, read after the table it
// sits beside has been shown.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return NextResponse.json(await asPerson(p, (db) => graph(db)), {
    headers: { "cache-control": "no-store" },
  });
}
