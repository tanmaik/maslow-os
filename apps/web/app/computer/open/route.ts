import { openLink } from "@/lib/computer";
import { principal } from "@/lib/session";

// Opens a port of the person's own: a fresh ticket for it, and the browser
// sent to the port's own address with it, so nothing of the app that
// answers there has to be rewritten.
async function open(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const port = Number(new URL(request.url).searchParams.get("port") ?? NaN);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return new Response("Say which port.", { status: 400 });
  const link = await openLink(p, port);
  if (!link)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.redirect(link, 303);
}

export { open as GET, open as POST };
