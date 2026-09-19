import { arrange } from "@/lib/computer";
import { principal } from "@/lib/session";

// The person's shelf in the order they dragged it into: the addresses of
// its apps, first to last. Only those on their own computer are theirs
// to arrange; the rest are left as they came.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  let hrefs: unknown;
  try {
    hrefs = await request.json();
  } catch {
    return new Response("That is not a shelf.", { status: 400 });
  }
  if (!Array.isArray(hrefs) || !hrefs.every((h) => typeof h === "string"))
    return new Response("That is not a shelf.", { status: 400 });
  const refused = await arrange(p, hrefs as string[]);
  if (refused) return new Response(refused, { status: 409 });
  return new Response(null, { status: 204 });
}
