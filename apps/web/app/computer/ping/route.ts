import { pingOf } from "@/lib/computer";
import { principal } from "@/lib/session";

// How long Maslow takes to reach the person's computer and back, for the
// page to say.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const ms = await pingOf(p);
  if (ms === null)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.json({ ms }, { headers: { "cache-control": "no-store" } });
}
