import { isUuid } from "@placeholder/db";
import { deleteSession, sessionOf } from "@placeholder/db/agents";

import { principal } from "@/lib/session";

// Deletes a conversation and everything in it. The transcript on the
// machine's disk is the harness's own and stays there.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  if (!(await sessionOf(p, id))) return new Response(null, { status: 404 });
  await deleteSession(p, id);
  return new Response(null, { status: 204 });
}
