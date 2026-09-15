import { asPerson } from "@maslow/db";
import { arrivalOf } from "@maslow/db/arrival";

import { deliverArrival } from "@/lib/arrival";
import { advance } from "@/lib/computer";
import { regionFor } from "@/lib/region";
import { principal } from "@/lib/session";

// Fly answers a make in seconds, but a placement can take longer.
export const maxDuration = 60;

// Where the person's computer stands, one step further on than before.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const state = await advance(p, await regionFor(request));
  // A computer that has come up is given what its person said on
  // arriving, if anything is still owed; the answer says whether it
  // still is, so the desk keeps asking until it is not.
  let trouble: string | null = null;
  if (state.progress === "ready")
    await deliverArrival(p).catch((err: Error) => {
      console.error(`arrival ${p.personId}: ${err.message}`);
      trouble = err.message;
    });
  const { owed } = await asPerson(p, arrivalOf);
  return Response.json({ ...state, owed, trouble });
}
