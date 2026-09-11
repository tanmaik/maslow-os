import { uploadTarget } from "@/lib/computer";
import { principal } from "@/lib/session";

// Where the browser sends an upload and what it carries to be let in: the
// machine's own door and a ticket for it. The bytes never pass through us.
export async function POST() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const target = await uploadTarget(p);
  if (!target)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.json(target);
}
