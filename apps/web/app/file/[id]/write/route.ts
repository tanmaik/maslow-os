import { Changed } from "@/lib/door";
import { principal } from "@/lib/session";
import { writeShared } from "@/lib/shares";
import { bounded, Rejected } from "@/lib/storage";

import { opened, refused } from "../opened";

// The most a save through here carries: what the editor holds.
const MOST = 2 * 1024 * 1024;

// A file of a shared thing written whole by a colleague at edit. The page
// says when the file was last changed as it opened it; a file changed
// since is not written over, but said, with when it changed.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  const p = (await principal())!;
  const openedAt = request.headers.get("x-maslow-opened") ?? undefined;
  try {
    const body = new Uint8Array(
      await (await bounded(request, MOST)).arrayBuffer(),
    );
    return Response.json(await writeShared(p, got.o, got.at, body, openedAt));
  } catch (err) {
    if (err instanceof Changed)
      return Response.json({ modified: err.modified }, { status: 409 });
    if (err instanceof Rejected)
      return new Response(err.message, { status: 413 });
    return refused(err);
  }
}
