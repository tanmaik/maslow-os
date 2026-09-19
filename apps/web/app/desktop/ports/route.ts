import { asPerson } from "@maslow/db";

import { standing } from "@/lib/computer";
import { desktopNow, portsOf } from "@/lib/desktop";
import { principal } from "@/lib/session";

// The ports the person can open this moment: their own as their computer
// reports them, and those opened to them; and how many times their desktop
// has been kept, so a page sees it change elsewhere. The room asks again
// while it is open, so a server started a minute ago is there without a
// reload, and a widget the agent placed is on screen within seconds. A
// computer that does not answer leaves the ports unsaid, and the desktop is
// still said; and where the computer stands, from its row, so a restart
// the app made greys the desktop the moment it is asked for.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const [rev, ports, computer] = await Promise.all([
    asPerson(p, desktopNow).then((d) => d?.rev ?? 0),
    portsOf(p).catch(() => null),
    standing(p),
  ]);
  return Response.json({ ports, rev, computer });
}
