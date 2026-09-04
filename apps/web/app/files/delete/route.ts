import { act } from "@/lib/act";
import { disk } from "@/lib/disk";
import { abandon, cleanPath } from "@/lib/files";
import { principal } from "@/lib/session";

// Deletes a file or a folder with everything in it, or abandons an upload
// still on its way.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async (form) => {
    const upload = form.get("upload");
    if (typeof upload === "string")
      return `deleted=${(await abandon(p, upload)) ? "yes" : "gone"}`;
    const target = cleanPath(form.get("target"));
    if (!target || target === "/") return "deleted=where";
    await disk.remove(p, target);
    return "deleted=yes";
  });
}
