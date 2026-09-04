import { signIn } from "@placeholder/db/auth";

import { finishSignIn, origin } from "../../../lib/oidc.ts";
import { pendingFlow, signedIn } from "../../../lib/session.ts";

// Where an OpenID Connect provider sends the browser back.
export async function GET(request: Request) {
  const flow = await pendingFlow();
  if (!flow || !("state" in flow))
    return new Response("No sign-in in progress.", { status: 400 });
  const base = origin(request);
  const { pathname, search } = new URL(request.url);
  const identity = await finishSignIn(new URL(pathname + search, base), flow);
  return signedIn(await signIn(identity), base);
}
