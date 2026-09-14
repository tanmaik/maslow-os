import { schedule, updateOf } from "@/lib/computer";
import { principal } from "@/lib/session";

// Restarting now reshapes the machine at Fly and waits on its door, which
// takes longer than a function's default.
export const maxDuration = 60;

const WHEN = ["now", "tonight", "idle"] as const;
type When = (typeof WHEN)[number];
const isWhen = (v: unknown): v is When =>
  typeof v === "string" && (WHEN as readonly string[]).includes(v);

// The update waiting on this person's computer, if one is: the menu bar
// asks now and again for its dot, and About and the Computer pane for the
// line they say.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return Response.json(await updateOf(p).catch(() => null));
}

// When their computer takes it: now, which restarts it here and then, or
// tonight or when idle, which the sweep keeps.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const when = (await request.json().catch(() => null)) as { when?: unknown };
  if (!isWhen(when?.when))
    return new Response("Now, tonight or idle.", { status: 400 });
  try {
    if (!(await schedule(p, when.when)))
      return new Response("There is no update waiting.", { status: 409 });
  } catch (err) {
    console.error(`update ${p.personId}: ${(err as Error).message}`);
    return new Response("The update could not be started. Try again.", {
      status: 409,
    });
  }
  return Response.json(await updateOf(p).catch(() => null));
}
