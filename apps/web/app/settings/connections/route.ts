import { NextResponse } from "next/server";

import { landing } from "@/app/settings/connections/landing";
import { connections, NAME } from "@/lib/connections";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Composio's ids are short and URL-safe.
const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;

// Sends the person to sign in to an app, names one of their accounts, or
// deletes one at the vendor. A vendor that refuses or does not answer is
// said on the page: the Settings window itself, or, for a connect, whose
// form takes the whole tab with it, the desk with that window open.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  if (!connections.enabled) return new Response(null, { status: 404 });
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const home = origin(request);
  const intent = text("intent");
  const back = (outcome: string) =>
    NextResponse.redirect(
      intent === "connect"
        ? landing(home, outcome)
        : `${home}/settings?connection=${outcome}`,
      303,
    );

  try {
    switch (intent) {
      case "connect": {
        const url = await connections.connect(
          p,
          text("app"),
          `${home}/settings/connections/callback`,
        );
        return url ? NextResponse.redirect(url, 303) : back("gone");
      }
      case "rename": {
        const id = text("account");
        const name = text("name");
        if (!ACCOUNT.test(id)) return back("gone");
        if (name && !NAME.test(name)) return back("name");
        return back(await connections.rename(p, id, name));
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
