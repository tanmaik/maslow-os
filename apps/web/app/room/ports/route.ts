import { asPerson } from "@maslow/db";

import { deskNow, portsOf } from "@/lib/room";
import { principal } from "@/lib/session";

// The ports the person can open this moment: their own as their computer
// reports them, and those opened to them; and how many times their desk
// has been kept, so a page sees it change elsewhere. The room asks again
// while it is open, so a server started a minute ago is there without a
// reload, and a widget the agent placed is on screen within seconds. A
// computer that does not answer leaves the ports unsaid, and the desk is
// still said.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const [rev, ports] = await Promise.all([
    asPerson(p, deskNow).then((d) => d?.rev ?? 0),
    portsOf(p).catch(() => null),
  ]);
  return Response.json({ ports, rev });
}
