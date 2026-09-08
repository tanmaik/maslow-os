import { list } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { principal } from "@/lib/session";

// What a picker offers: the few records that match what was typed, never the
// whole brain. Answers with an id, a type and a title, which is all a picker
// shows.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return NextResponse.json({ records: [] }, { status: 401 });
  const asked = new URL(request.url).searchParams;
  const query = asked.get("q")?.trim();
  const not = asked.get("not");
  const records = await asPerson(p, async (db) => {
    const page = await list(db, { limit: 20, ...(query ? { query } : {}) });
    return page.records
      .filter((r) => r.id !== not)
      .map((r) => ({ id: r.id, type: r.type, title: r.title }));
  });
  return NextResponse.json({ records });
}
