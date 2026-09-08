import { openLink } from "@/lib/computer";
import { principal } from "@/lib/session";

// Opens the person's computer: a fresh ticket, and the browser sent to
// the machine's own door with it, on to the path asked for when there
// is one, so a port's link opens without a visit to VS Code first.
async function open(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const link = await openLink(p, new URL(request.url).searchParams.get("to"));
  if (!link)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.redirect(link, 303);
}

export { open as GET, open as POST };
