import { NextResponse } from "next/server";

import { machineFrom, partUrl } from "@/lib/backups";

// Where a machine puts one part of its backup.
export async function POST(request: Request) {
  const m = await machineFrom(request);
  if (!m) return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null);
  const url = await partUrl(
    m,
    String(body?.id ?? ""),
    Number(body?.partNumber),
  );
  return url ? NextResponse.json({ url }) : new Response(null, { status: 404 });
}
