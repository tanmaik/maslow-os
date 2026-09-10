import { leaveLink } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal, signedOut } from "@/lib/session";

// Ends the session: the only way one ends. On the way home the browser is
// sent through the person's own computer, whose door throws away the
// ticket kept there. Without that, signing out leaves the next person at
// this browser holding the editor.
export async function POST(request: Request) {
  const home = origin(request);
  const p = await principal();
  const leave = p ? await leaveLink(p, home).catch(() => null) : null;
  return signedOut(leave ?? home);
}
