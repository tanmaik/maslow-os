import { fileAt, listAt } from "@/lib/trial-computer";
import { principal } from "@/lib/session";

import { typeOf } from "@/app/computer/files/serve";

// The trial's pretend home folder, behind the same addresses Files reads a
// real one at: the proxy sends them here in a trial, and answers every
// write itself.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ op: string }> },
) {
  if (!(await principal())) return new Response(null, { status: 401 });
  const { op } = await params;
  const at = new URL(request.url).searchParams.get("path") ?? ".";
  if (op === "list") {
    const list = listAt(at);
    return list
      ? Response.json(list)
      : new Response("No such folder.", { status: 404 });
  }
  if (op === "shared" || op === "share") return Response.json([]);
  if (op === "read") {
    const f = fileAt(at);
    if (!f) return new Response("No such file.", { status: 404 });
    if ("picture" in f)
      return Response.redirect(new URL(f.picture, request.url));
    return new Response(f.text, {
      headers: { "content-type": typeOf(at), "cache-control": "no-store" },
    });
  }
  return new Response("Not in the trial.", { status: 404 });
}
