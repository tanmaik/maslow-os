import { reset } from "@/lib/computer";
import { principal } from "@/lib/session";

// Resets the person's computer at their own ask, then shows them the page
// watching it come back. A reset the machine would not take is said in
// the door's own words, and nothing is changed.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  try {
    if (!(await reset(p)))
      return new Response("Your computer is not ready.", { status: 409 });
  } catch (err) {
    return new Response(`Could not reset: ${(err as Error).message}`, {
      status: 409,
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: "/settings?pane=computer" },
  });
}
