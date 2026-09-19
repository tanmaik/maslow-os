import { files } from "@/lib/computer";
import { Changed } from "@/lib/door";
import { principal } from "@/lib/session";

// A small file written whole: what an edit in the Preview window saves.
// The page says when the file was last changed as it opened it; a file
// changed since is not written over, but said, with when it changed.
export async function PUT(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (!at) return new Response("Which file?", { status: 400 });
  const opened = request.headers.get("x-maslow-opened") ?? undefined;
  try {
    return Response.json(
      await f.write(at, await request.text(), false, opened),
    );
  } catch (err) {
    if (err instanceof Changed)
      return Response.json({ modified: err.modified }, { status: 409 });
    return new Response((err as Error).message, { status: 502 });
  }
}
