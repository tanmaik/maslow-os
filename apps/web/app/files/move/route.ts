import { act } from "@/lib/act";
import { disk } from "@/lib/disk";
import { cleanPath, joined } from "@/lib/files";
import { principal } from "@/lib/session";

// Moves a file or a folder into another folder, made on the way if it
// does not exist yet.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async (form) => {
    const target = cleanPath(form.get("target"));
    const to = cleanPath(form.get("to"));
    if (!target || target === "/" || !to) return "moved=where";
    if (to === target || to.startsWith(`${target}/`)) return "moved=inside";
    await disk.mkdir(p, to);
    await disk.move(
      p,
      target,
      joined(to, target.slice(target.lastIndexOf("/") + 1)),
    );
    return "moved=yes";
  });
}
