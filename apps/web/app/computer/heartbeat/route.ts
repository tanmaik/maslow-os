import { runHeartbeat, setHeartbeat } from "@/lib/computer";
import { EVERY } from "@/lib/heartbeat";
import { principal } from "@/lib/session";

// How often the person's agent runs on its own on their computer: one of
// the cadences offered, in minutes, zero for off.
export async function PUT(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as { every?: unknown };
  const every = body?.every;
  if (typeof every !== "number" || !EVERY.some((e) => e.minutes === every))
    return new Response("Off, or one of the cadences offered.", {
      status: 400,
    });
  try {
    const told = await setHeartbeat(p, every);
    if (told === "behind")
      return new Response(
        "Written down. Your computer is on an image from before the heartbeat; it starts once you take the update waiting above.",
        { status: 202 },
      );
    if (told === "later")
      return new Response(
        "Written down, but your computer could not be told; it hears within the hour.",
        { status: 202 },
      );
  } catch (err) {
    console.error(`heartbeat ${p.personId}: ${(err as Error).message}`);
    return new Response("That could not be written down. Try again.", {
      status: 500,
    });
  }
  return new Response(null, { status: 204 });
}

// A run now, at the person's ask.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  try {
    if (!(await runHeartbeat(p)))
      return new Response("Your computer is not ready.", { status: 409 });
  } catch (err) {
    return new Response(`Could not start a run: ${(err as Error).message}`, {
      status: 409,
    });
  }
  return new Response(null, { status: 202 });
}
