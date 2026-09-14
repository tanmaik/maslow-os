import { isUuid } from "@maslow/db";

import { keep } from "@/lib/room";
import { principal } from "@/lib/session";

// A desktop as the browser left it: its whole arrangement kept.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  let body: { id?: unknown; layout?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("That is not a desktop.", { status: 400 });
  }
  if (typeof body.id !== "string" || !isUuid(body.id))
    return new Response("Which desktop?", { status: 400 });
  const kept = await keep(p, body.id, body.layout ?? null);
  if (!kept)
    return new Response("That arrangement does not hold.", { status: 400 });
  return Response.json(kept);
}
