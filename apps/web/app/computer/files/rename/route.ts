import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// A file or folder renamed, or moved when the new name is a path, through
// the machine's door; a name already taken is refused there.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  const { to } = ((await request.json().catch(() => null)) ?? {}) as {
    to?: string;
  };
  if (!at || !to)
    return new Response("Which file, to what name?", { status: 400 });
  try {
    return Response.json(await f.rename(at, to));
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
