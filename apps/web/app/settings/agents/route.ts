import { disconnectAgent } from "@placeholder/db/auth";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Ends an agent's access: its session is deleted, and its token is worthless
// from the next request.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const id = String((await request.formData()).get("session") ?? "");
  const ended = UUID.test(id) && (await disconnectAgent(p, id));
  return NextResponse.redirect(
    `${origin(request)}/settings?agent=${ended ? "disconnected" : "gone"}`,
    303,
  );
}
