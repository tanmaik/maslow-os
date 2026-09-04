import { NextResponse } from "next/server";

import { stop } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const outcome = await stop(p);
  return NextResponse.redirect(
    `${origin(request)}/computer?stop=${outcome}`,
    303,
  );
}
