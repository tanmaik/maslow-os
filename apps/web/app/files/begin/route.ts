import { NextResponse } from "next/server";

import { answer } from "@/lib/disk";
import { begin, cleanPath, FileRejected } from "@/lib/files";
import { principal } from "@/lib/session";

// Opens an upload for a file the browser is about to send in parts.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const size = Number(body?.size);
  const contentType = String(body?.type || "application/octet-stream").slice(
    0,
    100,
  );
  const path = cleanPath(body?.path ?? "/");
  if (!name || !Number.isFinite(size) || !path)
    return new Response("A file needs a name, a size and a folder.", {
      status: 400,
    });
  if (name.length > 255)
    return new Response("A name is at most 255 characters.", { status: 400 });
  if (size < 0) return new Response("A size is not negative.", { status: 400 });
  try {
    return NextResponse.json(await begin(p, { name, size, contentType, path }));
  } catch (err) {
    if (err instanceof FileRejected)
      return new Response(err.message, {
        status: /500 GB/.test(err.message) ? 413 : 400,
      });
    return answer(err);
  }
}
