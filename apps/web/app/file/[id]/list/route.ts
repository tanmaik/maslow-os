import { principal } from "@/lib/session";
import { listShared } from "@/lib/shares";

import { opened, refused } from "../opened";

// What one folder of a shared thing holds.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  const p = (await principal())!;
  try {
    const entries = await listShared(p, got.o, got.at);
    if (!entries) return new Response("Not found", { status: 404 });
    return Response.json(entries);
  } catch (err) {
    return refused(err);
  }
}
