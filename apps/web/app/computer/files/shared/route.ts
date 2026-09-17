import { principal } from "@/lib/session";
import { sharedWithMe } from "@/lib/shares";

// Everything colleagues shared with the person, by whom, for the rail in
// Files.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return Response.json(await sharedWithMe(p));
}
