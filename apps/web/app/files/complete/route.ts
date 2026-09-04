import { NextResponse } from "next/server";

import { complete, FileRejected } from "@/lib/files";
import { principal } from "@/lib/session";

// Closes an upload with the parts the browser sent.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  const parts = Array.isArray(body?.parts)
    ? body.parts.map((x: { partNumber: unknown; etag: unknown }) => ({
        partNumber: Number(x.partNumber),
        etag: String(x.etag ?? ""),
      }))
    : [];
  if (parts.length === 0) return new Response(null, { status: 400 });
  try {
    const file = await complete(p, id, parts);
    return file
      ? NextResponse.json({ id: file.id, size: file.size })
      : new Response(null, { status: 404 });
  } catch (err) {
    if (err instanceof FileRejected)
      return new Response(err.message, { status: 400 });
    throw err;
  }
}
