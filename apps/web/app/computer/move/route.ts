import { move } from "@/lib/computer";
import { isRegion } from "@/lib/region";
import { principal } from "@/lib/session";

// Starts moving the person's computer to the region they picked, at their
// own ask, then shows them the page watching it go.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const region = (await request.formData()).get("region");
  if (!isRegion(region))
    return new Response("No such region.", { status: 400 });
  try {
    if (!(await move(p, region)))
      return new Response("Your computer is not ready.", { status: 409 });
  } catch (err) {
    console.error(`move ${p.personId}: ${(err as Error).message}`);
    return new Response("The move could not be started. Try again.", {
      status: 409,
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: "/settings?pane=computer" },
  });
}
