import { Conflict, edit, get, history, isId } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { relayCaller } from "@/lib/sync";

// What the relay asks of a record, in the name of a member: its body, the
// change it rests on, and what that member may do with it.
async function said(
  p: NonNullable<Awaited<ReturnType<typeof relayCaller>>>,
  id: string,
) {
  return asPerson(p, async (db) => {
    const [last] = await history(db, { of: id, limit: 1 });
    const [r] = await get(db, [id]);
    if (!r || r.deletedAt) return null;
    return {
      body: r.body,
      seen: last?.seq ?? 0,
      access:
        r.access === "edit" || r.access === "owner"
          ? ("edit" as const)
          : ("view" as const),
    };
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await relayCaller(request);
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const now = await said(p, id);
  if (!now) return new Response(null, { status: 404 });
  return NextResponse.json(now);
}

// The relay saving a body in a member's name — their own typing, logged
// as theirs — resting on the change it knows. One that fell behind is
// refused, and the answer carries what the record says now so the relay
// can take it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await relayCaller(request);
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const { body, seen } = (await request.json()) as {
    body: unknown;
    seen: unknown;
  };
  if (typeof body !== "string" || !Number.isInteger(seen))
    return new Response("body and seen", { status: 400 });
  try {
    const landed = await asPerson(p, async (db) => {
      await edit(db, id, { body, seen: seen as number });
      return (await history(db, { of: id, limit: 1 }))[0]?.seq ?? 0;
    });
    return NextResponse.json({ seen: landed });
  } catch (err) {
    if (err instanceof Conflict) {
      const now = await said(p, id);
      if (!now) return new Response(null, { status: 404 });
      return NextResponse.json(now, { status: 409 });
    }
    throw err;
  }
}
