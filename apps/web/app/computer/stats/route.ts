import { statsOf } from "@/lib/computer";
import { principal } from "@/lib/session";

// The person's computer's numbers this moment, for the page to draw.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const s = await statsOf(p);
  if (!s) return new Response("Your computer is not ready.", { status: 409 });
  return Response.json(s);
}
