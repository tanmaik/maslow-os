import { NextResponse } from "next/server";

import { connections } from "@/lib/connections";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Composio's ids are short and URL-safe.
const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;

// Sends the person to sign in to an app, or deletes one of their accounts at
// the vendor. A vendor that refuses or does not answer is said on the page.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  if (!connections.enabled) return new Response(null, { status: 404 });
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const home = origin(request);
  const back = (outcome: string) =>
    NextResponse.redirect(`${home}/settings?connection=${outcome}`, 303);

  try {
    switch (text("intent")) {
      case "connect": {
        const url = await connections.connect(
          p,
          text("app"),
          `${home}/settings/connections/callback`,
        );
        return url ? NextResponse.redirect(url, 303) : back("gone");
      }
      case "disconnect": {
        const id = text("account");
        if (!ACCOUNT.test(id)) return back("gone");
        return back(
          (await connections.disconnect(p, id)) ? "disconnected" : "gone",
        );
      }
    }
  } catch (err) {
    console.error(`connections: ${(err as Error).message}`);
    return back("unanswered");
  }
  return new Response(null, { status: 400 });
}
