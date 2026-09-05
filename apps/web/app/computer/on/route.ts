import { act } from "@/lib/act";
import { powerOn } from "@/lib/computer";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 120;

// Powers the person's computer on again: compute on the same disk.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async () => {
    await powerOn(p);
    return "computer=on";
  });
}
