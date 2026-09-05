import { Forbidden, setComputers } from "@placeholder/db/settings";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Switches the org's computers on or off. Owners only.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const on = (await request.formData()).get("on") === "yes";
  try {
    await setComputers(p, on);
  } catch (err) {
    if (err instanceof Forbidden)
      return new Response(err.message, { status: 403 });
    throw err;
  }
  return NextResponse.redirect(
    `${origin(request)}/settings?computers=${on ? "on" : "off"}`,
    303,
  );
}
