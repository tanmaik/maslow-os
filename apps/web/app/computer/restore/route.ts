import { act } from "@/lib/act";
import { restoreUrl } from "@/lib/backups";
import { disk } from "@/lib/disk";
import { principal } from "@/lib/session";

// Puts a backup back onto an empty disk.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async (form) => {
    const url = await restoreUrl(p, String(form.get("backup") ?? ""));
    if (!url) return "restored=gone";
    await disk.restore(p, url);
    return "restored=yes";
  });
}
