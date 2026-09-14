import { resize } from "@/lib/computer";
import { principal } from "@/lib/session";
import { isSize } from "@/lib/sizes";

// Moves the person's computer to the size they picked: a restart of a few
// seconds, then the page watching it come back.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const size = (await request.formData()).get("size");
  if (!isSize(size)) return new Response("No such size.", { status: 400 });
  try {
    if (!(await resize(p, size)))
      return new Response("Your computer is not ready.", { status: 409 });
  } catch (err) {
    return new Response(`Could not change size: ${(err as Error).message}`, {
      status: 409,
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: "/settings?pane=computer" },
  });
}
