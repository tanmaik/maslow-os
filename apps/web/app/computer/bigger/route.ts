import { act } from "@/lib/act";
import { askBigger } from "@/lib/computer";
import { DiskError } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long: a cold boot at another size is a
// machine destroyed and one made, and Fly's own minute for each.
export const maxDuration = 300;

// Restarts the person's computer with more memory, now. One already being
// built or resized is busy, and says so; so does one there is no bigger
// size for, one that is powered off, and one whose bigger size Fly could
// not place, which comes back at the size that worked.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async () => {
    const r = await askBigger(p);
    if (r === "top") return "bigger=top";
    if (r === "unplaceable") return "bigger=unplaceable";
    if (r === "busy")
      throw new DiskError(
        409,
        "Your computer is being worked on; try again in a moment.",
      );
    if (r === "powered-off")
      throw new DiskError(
        409,
        "Your computer is powered off. Power it on first.",
      );
    if (r === "not-allowed")
      throw new DiskError(403, "Computers are off for this org.");
    if (r === "gone")
      throw new DiskError(
        503,
        "Your computer did not come up at the new size; try again in a moment.",
      );
    return "bigger=done";
  });
}
