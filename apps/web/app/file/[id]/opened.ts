import { principal } from "@/lib/session";
import { Refused, openShared, type Opened } from "@/lib/shares";

// The shared thing a route under /file/[id] is about, for the person
// asking, and the path under it the query names. Null is one 404 for
// every way of not being allowed.
export async function opened(
  request: Request,
  params: Promise<{ id: string }>,
): Promise<{ o: Opened; at: string } | null> {
  const { id } = await params;
  const p = await principal();
  const o = p ? await openShared(p, id) : null;
  if (!o) return null;
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (at.includes("\0") || at.startsWith("/") || at.split("/").includes(".."))
    return null;
  return { o, at };
}

// What a refusal is told as, and anything else as the door's fault.
export function refused(err: unknown): Response {
  if (err instanceof Refused) return new Response(err.message, { status: 409 });
  return new Response((err as Error).message, { status: 502 });
}
