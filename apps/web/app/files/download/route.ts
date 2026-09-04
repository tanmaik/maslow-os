import { disk } from "@/lib/disk";
import { cleanPath } from "@/lib/files";
import { principal } from "@/lib/session";

// Sends the browser to the machine for the file, with a link it signed.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const path = cleanPath(new URL(request.url).searchParams.get("path"));
  if (!path || path === "/") return new Response(null, { status: 404 });
  return Response.redirect(await disk.downloadUrl(p, path), 302);
}
