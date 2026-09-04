import { NextResponse } from "next/server";

import { begin, machineFrom } from "@/lib/backups";

// A machine opening a backup of its disk.
export async function POST(request: Request) {
  const m = await machineFrom(request);
  if (!m) return new Response(null, { status: 404 });
  const opened = await begin(m);
  return opened
    ? NextResponse.json(opened)
    : new Response("A backup is already on its way.", { status: 409 });
}
