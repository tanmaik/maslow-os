import { principal } from "@/lib/session";
import { statShared } from "@/lib/shares";

import { opened, refused } from "../opened";

// One file of a shared thing as it is now: its name, kind, size and when
// it last changed, whose it is, how much the person may do with it, and
// whether the answer came from the machine or its copy.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  const p = (await principal())!;
  try {
    const s = await statShared(p, got.o, got.at);
    if (!s) return new Response("Nothing is there.", { status: 404 });
    return Response.json({
      ...s,
      owner: got.o.file.owner,
      ownerId: got.o.file.ownerId,
      level: got.o.file.level,
      shared: {
        id: got.o.file.id,
        name: got.o.file.name,
        kind: got.o.file.kind,
      },
    });
  } catch (err) {
    return refused(err);
  }
}
