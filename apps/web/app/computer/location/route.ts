import { locationTarget } from "@/lib/computer";
import { principal } from "@/lib/session";

// Where the browser sends the person's location: the machine's own door,
// with a ticket for it. The position never passes through us.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const target = await locationTarget(p);
  if (!target)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.json(target);
}
