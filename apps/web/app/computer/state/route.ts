import { advance } from "@/lib/computer";
import { regionFor } from "@/lib/region";
import { principal } from "@/lib/session";

// Fly answers a make in seconds, but a placement can take longer.
export const maxDuration = 60;

// Where the person's computer stands, one step further on than before.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return Response.json(await advance(p, await regionFor(request)));
}
