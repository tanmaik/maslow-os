import { NextResponse } from "next/server";

import { connections } from "@/lib/connections";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;

// Where the browser lands after signing in to an app. The address names the
// account; what came of it is asked of the vendor.
export async function GET(request: Request) {
  const home = origin(request);
  const p = await principal();
  if (!p) return NextResponse.redirect(home, 303);
  const id =
    new URL(request.url).searchParams.get("connected_account_id") ?? "";
  const outcome = ACCOUNT.test(id)
    ? await connections.confirm(p, id).catch((err: Error) => {
        console.error(`connections: ${err.message}`);
        return "unanswered";
      })
    : "gone";
  return NextResponse.redirect(`${home}/settings?connection=${outcome}`, 303);
}
