import { share } from "@/lib/computer";
import { principal } from "@/lib/session";

// Sets what one port of the person's own computer reaches, the public
// included. The sheet sends everything it ticked, so what comes back is the
// whole list and whoever was left off is taken off in the same act.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const port = Number(form.get("port"));
  const named = (field: string) =>
    form.getAll(field).filter((v): v is string => typeof v === "string");
  const to = {
    public: form.get("public") === "on",
    everyone: form.get("everyone") === "on",
    groupIds: named("group"),
    memberIds: named("member"),
  };
  const shared = await share(p, port, to);
  if (!shared)
    return new Response("Your computer is not ready.", { status: 409 });
  if (shared === "untold")
    return new Response(
      "Saved, but your computer's door could not be told; it hears within the hour. Save again to try now.",
      { status: 502 },
    );
  return new Response(null, { status: 204 });
}
