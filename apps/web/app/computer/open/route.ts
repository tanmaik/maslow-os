import { openLink } from "@/lib/computer";
import { principal } from "@/lib/session";

// Opens the person's computer: a fresh ticket, and the browser sent to
// the machine's own door with it.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const link = await openLink(p);
  if (!link)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.redirect(link, 303);
}
