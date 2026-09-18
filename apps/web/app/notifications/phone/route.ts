import { asPerson } from "@maslow/db";
import { membershipsOf } from "@maslow/db/auth";
import { forgetPhone, registerPhone } from "@maslow/db/phones";
import { NextResponse } from "next/server";

import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// A phone says how to reach it while the app is closed: the token Apple's
// push service gave it, and whether it is a development build. Forgotten
// again when the person signs out on it. Where this deployment has no
// push key, the phone is told so and nothing is kept.
export async function PUT(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  if (deployment.push.kind === "none")
    return NextResponse.json(
      { said: "This copy of Maslow cannot push." },
      { status: 404 },
    );
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    sandbox?: unknown;
  } | null;
  if (typeof body?.token !== "string" || !/^[0-9a-f]{32,}$/i.test(body.token))
    return new Response(null, { status: 400 });
  const sandbox = body.sandbox === true;
  await asPerson(p, (q) =>
    registerPhone(q, { token: body.token as string, sandbox }),
  );
  return NextResponse.json({ kept: true });
}

export async function DELETE(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  if (typeof body?.token !== "string")
    return new Response(null, { status: 400 });
  const token = body.token;
  for (const m of await membershipsOf(p)) await forgetPhone(m.orgId, token);
  return new Response(null, { status: 204 });
}
