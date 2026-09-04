import { act } from "@/lib/act";
import { disk } from "@/lib/disk";
import { cleanName, joined } from "@/lib/files";
import { principal } from "@/lib/session";

// Makes a folder inside the one the person is looking at.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async (form, at) => {
    const name = cleanName(form.get("name"));
    if (!name) return "folder=name";
    await disk.mkdir(p, joined(at, name));
    return "folder=made";
  });
}
