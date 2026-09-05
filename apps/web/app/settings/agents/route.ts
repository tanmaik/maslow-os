import { isUuid } from "@placeholder/db";
import { disconnectAgent } from "@placeholder/db/auth";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Ends an agent's access: its session is deleted, and its token is worthless
// from the next request.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const id = String((await request.formData()).get("session") ?? "");
  const ended = isUuid(id) && (await disconnectAgent(p, id));
  return NextResponse.redirect(
    `${origin(request)}/settings?agent=${ended ? "disconnected" : "gone"}`,
    303,
  );
}
