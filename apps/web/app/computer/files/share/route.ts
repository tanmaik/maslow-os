import { after } from "next/server";

import { principal } from "@/lib/session";
import {
  Refused,
  refreshAfterRead,
  openShared,
  shareFile,
  sharingOf,
  tellReached,
} from "@/lib/shares";

// What the sheet on a file or folder of the person's own needs: who it
// can be given to, and everything they have shared with who each reaches.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const sharing = await sharingOf(p);
  if (!sharing)
    return new Response("Your computer is not ready.", { status: 409 });
  return Response.json(sharing);
}

// Sets what one file or folder of the person's own reaches. The sheet
// sends everything it ticked, so whoever was left off is taken off in the
// same act; nobody ticked ends the share. A share landing is copied out
// and said to each person it reached.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    everyone?: unknown;
    groups?: unknown;
    members?: unknown;
    level?: unknown;
  } | null;
  const ids = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const at = typeof body?.path === "string" ? body.path : "";
  const level = body?.level === "edit" ? "edit" : "view";
  if (!at) return new Response("Which file?", { status: 400 });
  const to = {
    everyone: body?.everyone === true,
    groupIds: ids(body?.groups),
    memberIds: ids(body?.members),
    level,
  } as const;
  try {
    const { file, shared } = await shareFile(p, at, to);
    if (shared) {
      await tellReached(p, file, to);
      after(async () => {
        const o = await openShared(p, file.id);
        if (o) await refreshAfterRead(o);
      });
    }
    return Response.json({ id: file.id, shared });
  } catch (err) {
    if (err instanceof Refused)
      return new Response(err.message, { status: 409 });
    return new Response((err as Error).message, { status: 502 });
  }
}
