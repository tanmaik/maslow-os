import { isUuid } from "@placeholder/db";
import { sessionOf, settleSession } from "@placeholder/db/agents";

import { principal } from "@/lib/session";

// Sets a conversation aside, or brings it back: `settled` in the body.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  if (!(await sessionOf(p, id))) return new Response(null, { status: 404 });
  let settled = true;
  try {
    settled = Boolean((await request.json()).settled ?? true);
  } catch {}
  await settleSession(p, id, settled);
  return new Response(null, { status: 204 });
}
