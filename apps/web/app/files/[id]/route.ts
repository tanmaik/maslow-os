import { disposition, downloadUrl, localStream } from "@/lib/files";
import { principal } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Sends the browser to the file: the bucket signs a URL for it; a local
// store serves the bytes itself.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  const url = await downloadUrl(p, id);
  if (url) return Response.redirect(url, 302);
  const local = await localStream(p, id);
  if (!local) return new Response(null, { status: 404 });
  return new Response(local.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": disposition(local.file.name),
      "x-content-type-options": "nosniff",
    },
  });
}
