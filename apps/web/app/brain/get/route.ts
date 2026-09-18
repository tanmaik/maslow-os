import { edgesOf, get, isId, stubs } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { principal } from "@/lib/session";

import { peopleOf } from "../people";

// One record whole, with every link touching it and what stands at the
// other end, so the phone's record page is one read.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isId(id)) return new Response(null, { status: 400 });
  const found = await asPerson(p, async (db) => {
    const [record] = await get(db, [id]);
    if (!record) return null;
    const edges = await edgesOf(db, id);
    const others = await stubs(db, [
      ...new Set(edges.map((e) => (e.fromId === id ? e.toId : e.fromId))),
    ]);
    const other = new Map(others.map((o) => [o.id, o]));
    const people = await peopleOf(db);
    return {
      record: {
        ...record,
        owner: record.ownerId === p.userId ? null : people.get(record.ownerId),
      },
      links: edges.flatMap((e) => {
        const out = e.fromId === id;
        const end = other.get(out ? e.toId : e.fromId);
        return end
          ? [
              {
                id: e.id,
                verb: e.verb,
                out,
                record: { id: end.id, type: end.type, title: end.title },
              },
            ]
          : [];
      }),
    };
  });
  if (!found) return new Response(null, { status: 404 });
  return NextResponse.json(found, { headers: { "cache-control": "no-store" } });
}
