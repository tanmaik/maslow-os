import { act } from "@/lib/act";
import { powerOn } from "@/lib/computer";
import { DiskError } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long: a machine is made and Fly takes up
// to a minute to place it.
export const maxDuration = 300;

// Powers the person's computer on again: compute on the same disk.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async () => {
    const r = await powerOn(p);
    if (r === "busy")
      throw new DiskError(
        409,
        "Your computer is being worked on; try again in a moment.",
      );
    if (r === "gone")
      throw new DiskError(
        503,
        "Your computer did not come up; try again in a moment.",
      );
    if (r !== "on") throw new DiskError(403, "Computers are off for this org.");
    return "computer=on";
  });
}
