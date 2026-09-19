import { publish } from "@/lib/computer";
import { principal } from "@/lib/session";

// The most a face may weigh, as the bytes of the picture itself.
const HEAVIEST_FACE = 48 * 1024;

// Publishes one port of the person's own computer as an app, named and
// wearing the face the sheet sent, a picture they chose or the port's own,
// or takes one off the shelf when the sheet says so. What cannot be done
// is said in words.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const port = Number(form.get("port"));
  if (form.get("unpublish") === "on") {
    const refused = await publish(p, port, null);
    return refused
      ? new Response(refused, { status: 409 })
      : new Response(null, { status: 204 });
  }
  const name = form.get("name");
  const chosen = form.get("icon");
  const own = form.get("face");
  let icon: string | null = typeof own === "string" && own ? own : null;
  if (chosen instanceof File && chosen.size > 0) {
    if (chosen.size > HEAVIEST_FACE || !chosen.type.startsWith("image/"))
      return new Response("That picture is too heavy for a face.", {
        status: 409,
      });
    const bytes = Buffer.from(await chosen.arrayBuffer());
    icon = `data:${chosen.type};base64,${bytes.toString("base64")}`;
  }
  const refused = await publish(p, port, {
    name: typeof name === "string" ? name : "",
    icon,
  });
  if (refused) return new Response(refused, { status: 409 });
  return new Response(null, { status: 204 });
}
