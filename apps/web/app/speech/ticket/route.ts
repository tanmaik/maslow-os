import { principal } from "@/lib/session";
import { ear } from "@/lib/speech";

// Where the person's browser streams their voice and what lets it in,
// asked for as the thumb lands on the button. Nothing where this
// deployment cannot hear.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  let target;
  try {
    target = await ear();
  } catch (err) {
    console.error(`speech ${p.personId}: ${(err as Error).message}`);
    return new Response(`Nothing can be heard: ${(err as Error).message}.`, {
      status: 502,
    });
  }
  if (!target)
    return new Response("This copy of Maslow cannot hear.", { status: 404 });
  return Response.json(target, { headers: { "cache-control": "no-store" } });
}
