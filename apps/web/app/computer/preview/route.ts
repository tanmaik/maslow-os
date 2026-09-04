import { disk } from "@/lib/disk";
import { principal } from "@/lib/session";

// Sends the browser to an app the machine serves on a port, by a link the
// machine will honour.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const port = Number(new URL(request.url).searchParams.get("port"));
  if (!(port > 0 && port < 65536)) return new Response(null, { status: 404 });
  const { ports } = await disk.ports(p);
  if (!ports.includes(port)) return new Response(null, { status: 404 });
  return Response.redirect(await disk.previewUrl(p, port), 302);
}
