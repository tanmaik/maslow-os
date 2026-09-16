import { asPerson, isUuid } from "@maslow/db";

import { desktopNow, keep } from "@/lib/desktop";
import { principal } from "@/lib/session";

// The desktop as it now is, for a page that saw it change elsewhere.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const desktop = await asPerson(p, desktopNow);
  if (!desktop)
    return new Response("There is no desktop yet.", { status: 404 });
  return Response.json(desktop);
}

// A desktop as the browser left it: its whole arrangement kept, resting on
// the count it saw. One that fell behind is refused, and the desktop as it
// now is comes back with the refusal.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  let body: { id?: unknown; layout?: unknown; rev?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("That is not a desktop.", { status: 400 });
  }
  if (typeof body.id !== "string" || !isUuid(body.id))
    return new Response("Which desktop?", { status: 400 });
  if (typeof body.rev !== "number" || !Number.isInteger(body.rev))
    return new Response("Resting on which count?", { status: 400 });
  const kept = await keep(p, body.id, body.layout ?? null, body.rev);
  if (!kept)
    return new Response("That arrangement does not hold.", { status: 400 });
  if ("behind" in kept) return Response.json(kept.behind, { status: 409 });
  return Response.json(kept);
}
