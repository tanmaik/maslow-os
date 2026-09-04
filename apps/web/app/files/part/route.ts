import { NextResponse } from "next/server";

import { answer } from "@/lib/disk";

import { partUrl } from "@/lib/files";
import { principal } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Where to send one part of an upload in progress.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  const partNumber = Number(body?.partNumber);
  if (!(partNumber >= 1 && partNumber <= 10000))
    return new Response(null, { status: 400 });
  const url = await partUrl(p, id, partNumber);
  return url ? NextResponse.json({ url }) : new Response(null, { status: 404 });
}
