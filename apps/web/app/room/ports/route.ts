import { portsOf } from "@/lib/room";
import { principal } from "@/lib/session";

// The ports the person can open this moment: their own as their computer
// reports them, and those opened to them. The room asks again while it is
// open, so a server started a minute ago is there without a reload.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  try {
    return Response.json(await portsOf(p));
  } catch {
    return new Response("The computer is not answering.", { status: 503 });
  }
}
