import { act } from "@/lib/act";
import { askBigger } from "@/lib/computer";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 120;

// Restarts the person's computer with more memory, now. One already being
// built or resized is busy, and says so.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const r = await askBigger(p);
  if (r === "exists")
    return new Response("Your computer is busy; ask again in a moment.", {
      status: 409,
    });
  return act(request, async () => (r === "top" ? "bigger=top" : "bigger=done"));
}
