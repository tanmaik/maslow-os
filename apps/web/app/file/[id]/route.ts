import { principal } from "@/lib/session";
import { openShared } from "@/lib/shares";

// A file or folder somebody shared, at the address they hand out. Signed
// in and given it, the browser goes on to the Preview window or Files;
// anything else is nothing at all, so a link tells whoever holds it
// nothing about whether there is something behind it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const p = await principal();
  const o = p ? await openShared(p, id) : null;
  if (!o) return new Response("Not found", { status: 404 });
  const to =
    o.file.kind === "dir"
      ? `/computer/files?share=${encodeURIComponent(id)}`
      : `/computer/files/view?share=${encodeURIComponent(id)}`;
  return Response.redirect(new URL(to, request.url), 303);
}
