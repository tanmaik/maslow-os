import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// A small file written whole: what an edit in the Files window saves.
export async function PUT(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (!at) return new Response("Which file?", { status: 400 });
  try {
    return Response.json({ size: await f.write(at, await request.text()) });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
