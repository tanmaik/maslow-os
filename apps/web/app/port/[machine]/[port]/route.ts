import { sharedLink } from "@/lib/computer";
import { principal } from "@/lib/session";

// A port somebody opened on their computer, at the address they hand out.
// This is where the deciding happens: signed in and given this port, the
// browser goes on to the machine with a ticket for that port alone.
// Anything else is nothing at all, so a link tells whoever holds it
// nothing about whether there is something behind it.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ machine: string; port: string }> },
) {
  const { machine, port } = await params;
  const p = await principal();
  const link = p ? await sharedLink(p, machine, Number(port)) : null;
  if (!link) return new Response("Not found", { status: 404 });
  return Response.redirect(link, 303);
}
