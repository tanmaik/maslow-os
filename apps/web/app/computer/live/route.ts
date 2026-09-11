import { liveTarget } from "@/lib/computer";
import { principal } from "@/lib/session";

// Where the person's browser opens its live sockets and what it carries
// to be let in: the machine's own door and a ticket for it, good for an
// hour. Nothing on those sockets passes through us.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const target = await liveTarget(p);
  if (!target)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.json(target, { headers: { "cache-control": "no-store" } });
}
