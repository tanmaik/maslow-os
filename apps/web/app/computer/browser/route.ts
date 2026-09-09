import { browserShotOf } from "@/lib/computer";
import { principal } from "@/lib/session";

// What the computer's browser is looking at this moment: a picture, or
// nothing while the browser is closed.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const shot = await browserShotOf(p);
  if (!shot) return new Response(null, { status: 204 });
  return new Response(Buffer.from(shot), {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
  });
}
