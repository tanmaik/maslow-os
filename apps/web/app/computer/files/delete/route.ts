import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// A file or folder moved to the Trash of the person's Linux, through the
// machine's door; nothing is erased.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (!at) return new Response("Which file?", { status: 400 });
  try {
    return Response.json(await f.trash(at));
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
