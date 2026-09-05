import { act } from "@/lib/act";
import { powerOff } from "@/lib/computer";
import { DiskError } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 60;

// Powers the person's computer off: the machine goes, the disk stays.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async () => {
    if ((await powerOff(p)) === "busy")
      throw new DiskError(
        409,
        "Your computer is being worked on; try again in a moment.",
      );
    return "computer=off";
  });
}
