import { act } from "@/lib/act";
import { restoreUrl } from "@/lib/backups";
import { disk } from "@/lib/disk";
import { principal } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Vercel gives this request this long.
export const maxDuration = 60;

// Puts a backup back onto an empty disk; the machine carries on alone and
// the page says how it is going.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async (form) => {
    const id = String(form.get("backup") ?? "");
    if (!UUID.test(id)) return "restored=gone";
    const url = await restoreUrl(p, id);
    if (!url) return "restored=gone";
    await disk.restore(p, url);
    return "restored=started";
  });
}
