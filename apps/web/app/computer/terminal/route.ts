import { NextResponse } from "next/server";

import { answer, disk } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 60;

// A fresh signed link to a shell, for a terminal opening one again.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  try {
    return NextResponse.json({ url: await disk.terminalUrl(p) });
  } catch (err) {
    return answer(err);
  }
}
