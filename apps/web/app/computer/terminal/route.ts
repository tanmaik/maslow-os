import { NextResponse } from "next/server";

import { answer, disk } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 60;

// A signed link to a shell, for the session the browser names: a tab
// asks for its own, and asks again whenever its socket closes.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const session = new URL(request.url).searchParams.get("session") ?? "";
  if (!/^[A-Za-z0-9-]{1,64}$/.test(session))
    return new Response("A terminal names the session it opens.", {
      status: 400,
    });
  try {
    return NextResponse.json({ url: await disk.terminalUrl(p, session) });
  } catch (err) {
    return answer(err);
  }
}
