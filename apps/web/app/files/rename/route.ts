import { act } from "@/lib/act";
import { disk } from "@/lib/disk";
import { cleanName, cleanPath, joined, parentOf } from "@/lib/files";
import { principal } from "@/lib/session";

// Renames a file or a folder in place.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async (form) => {
    const target = cleanPath(form.get("target"));
    const name = cleanName(form.get("name"));
    if (!target || target === "/" || !name) return "renamed=name";
    await disk.move(p, target, joined(parentOf(target), name));
    return "renamed=yes";
  });
}
