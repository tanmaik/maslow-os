import { drop, keep } from "@/lib/room";
import { principal } from "@/lib/session";

// A desktop as the browser left it: its whole arrangement kept, a new one
// made, or one taken away.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  let body: { id?: unknown; layout?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("That is not a desktop.", { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : null;
  const kept = await keep(p, id, body.layout ?? null);
  if (!kept)
    return new Response("That arrangement does not hold.", { status: 400 });
  return Response.json(kept);
}

export async function DELETE(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string")
    return new Response("Which desktop?", { status: 400 });
  return (await drop(p, id))
    ? new Response(null, { status: 204 })
    : new Response("No such desktop.", { status: 404 });
}
