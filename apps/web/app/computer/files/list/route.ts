import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// What one folder of the person's home holds.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? ".";
  try {
    return Response.json(await f.list(at));
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
