import { get, isId } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { mint, nameOf } from "@maslow/sync/ticket";
import { NextResponse } from "next/server";

import { deployment } from "@/lib/deployment";
import { relayUrl } from "@/lib/relay";
import { principal } from "@/lib/session";

// A way into a record's live document: where the relay is, what the
// document is called there, and a ticket naming this deployment, the
// person, the record and what they may do in it, good for an hour.
// Nothing where there is no relay, or none running yet.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  if (deployment.sync.kind === "none")
    return new Response(null, { status: 404 });
  const url = await relayUrl();
  if (!url) return new Response(null, { status: 404 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const [r] = await asPerson(p, (db) => get(db, [id]));
  if (!r || r.deletedAt) return new Response(null, { status: 404 });
  const level =
    r.access === "edit" || r.access === "owner"
      ? ("edit" as const)
      : ("view" as const);
  const claims = {
    origin: deployment.sync.origin,
    org: p.orgId,
    user: p.userId,
    record: id,
    level,
  };
  return NextResponse.json({
    url,
    name: nameOf(claims),
    ticket: mint(deployment.sync.secret, claims, 3600),
  });
}
