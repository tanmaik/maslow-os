import { asOrg } from "@placeholder/db";
import { invite } from "@placeholder/db/auth";
import { NextResponse } from "next/server";

import { deployment } from "@/lib/deployment";
import { mailable, send } from "@/lib/mail";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Invites an email into the signed-in person's org, and tells them by mail
// when this deployment can send any and the invitation is new.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const email = (await request.formData()).get("email");
  if (typeof email !== "string" || !email.includes("@") || email.length > 254)
    return new Response("An email address is required.", { status: 400 });
  const address = email.trim().toLowerCase();
  const home = origin(request);

  // Asked before the invitation exists, so nothing is made that cannot be
  // told about.
  if (deployment.mail.kind !== "none" && !mailable(address))
    return NextResponse.redirect(`${home}/settings?invite=founders`, 303);
  const outcome = await invite(p, address);
  if (outcome === "sent" && deployment.mail.kind !== "none") {
    const org = await asOrg(
      p.orgId,
      async (q) =>
        (await q.query<{ name: string }>("select name from orgs")).rows[0]!
          .name,
    );
    await send({
      to: address,
      subject: `You're invited to ${org}`,
      text: `Sign in at ${home} with this email address and you'll be in ${org}.`,
    });
  }
  return NextResponse.redirect(`${home}/settings?invite=${outcome}`, 303);
}
