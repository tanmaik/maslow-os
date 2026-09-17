import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// A folder made in a folder of the home, through the machine's door, named
// as asked or as the Finder names one.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  const { name } = ((await request.json().catch(() => null)) ?? {}) as {
    name?: string;
  };
  try {
    return Response.json(await f.mkdir(at, name || undefined));
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
