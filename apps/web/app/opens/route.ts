import { asPerson } from "@maslow/db";
import { takeOpens } from "@maslow/db/opens";

import { standing } from "@/lib/computer";
import { principal } from "@/lib/session";

// What the shell asks every few seconds: what the agent asked to put in
// front of the person since it last looked, handed over once, so whichever
// of their screens asks first opens it; and where their computer stands,
// from its row, so a restart covers the screen the moment it is asked for.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const [opens, computer] = await Promise.all([
    asPerson(p, takeOpens),
    standing(p),
  ]);
  return Response.json({ opens, computer });
}
