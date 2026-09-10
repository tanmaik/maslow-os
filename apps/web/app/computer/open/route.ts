import { openLink } from "@/lib/computer";
import { principal } from "@/lib/session";

// Opens the person's computer: a fresh ticket, and the browser sent to the
// machine's own door with it, on to the path asked for when there is one.
// A port of theirs opens at its own address, so nothing of the app that
// answers there has to be rewritten.
async function open(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const asked = new URL(request.url).searchParams;
  const port = asked.get("port");
  const link = await openLink(
    p,
    asked.get("to"),
    port === null ? null : Number(port),
  );
  if (!link)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.redirect(link, 303);
}

export { open as GET, open as POST };
