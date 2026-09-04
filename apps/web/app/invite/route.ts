import { asOrg } from "@placeholder/db";
import { invite } from "@placeholder/db/auth";
import { NextResponse } from "next/server";

import { deployment } from "../../lib/deployment.ts";
import { send } from "../../lib/mail.ts";
import { origin } from "../../lib/oidc.ts";
import { principal } from "../../lib/session.ts";

// Invites an email into the signed-in person's org, and tells them by mail
// when this deployment can send any.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const email = (await request.formData()).get("email");
  if (typeof email !== "string" || !email.includes("@"))
    return new Response("An email address is required.", { status: 400 });
  const address = email.trim().toLowerCase();
  await invite(p.orgId, address);

  if (deployment.mail.kind !== "none") {
    const home = origin(request);
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
  return NextResponse.redirect(origin(request), 303);
}
