import { signIn } from "@placeholder/db/auth";

import { origin } from "../../../lib/oidc.ts";
import { pendingFlow, signedIn } from "../../../lib/session.ts";
import { redeemCode, WorkOSError } from "../../../lib/workos.ts";

// Second leg of a code sign-in: the code comes back and a session opens.
export async function POST(request: Request) {
  const flow = await pendingFlow();
  if (!flow || !("email" in flow))
    return new Response("No sign-in in progress.", { status: 400 });
  const code = (await request.formData()).get("code");
  if (typeof code !== "string")
    return new Response("A code is required.", { status: 400 });
  const home = origin(request);
  try {
    const identity = await redeemCode(flow.email, code.trim());
    return signedIn(await signIn(identity), home);
  } catch (err) {
    if (err instanceof WorkOSError && err.status < 500)
      return Response.redirect(`${home}/?code=wrong`, 303);
    throw err;
  }
}
