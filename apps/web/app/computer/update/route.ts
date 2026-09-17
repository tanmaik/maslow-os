import { take, updateOf } from "@/lib/computer";
import { principal } from "@/lib/session";

// Taking an update reshapes the machine at Fly and waits on its door,
// which takes longer than a function's default.
export const maxDuration = 60;

// The update waiting on this person's computer, if one is: the menu bar
// asks every few minutes for its dot, and About and the Computer pane for
// the line they say.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return Response.json(await updateOf(p).catch(() => null));
}

// The person taking it: their computer restarts onto the image here and
// then.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  try {
    if (!(await take(p)))
      return new Response("There is no update waiting.", { status: 409 });
  } catch (err) {
    console.error(`update ${p.personId}: ${(err as Error).message}`);
    return new Response("The update could not be started. Try again.", {
      status: 409,
    });
  }
  return Response.json(await updateOf(p).catch(() => null));
}
