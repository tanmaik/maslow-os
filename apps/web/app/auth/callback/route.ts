import { signIn } from "@placeholder/db/auth";

import { finishSignIn } from "@/lib/oidc";
import { origin } from "@/lib/origin";
import { abandoned, pendingFlow, signedIn } from "@/lib/session";

// Where an OpenID Connect provider sends the browser back.
export async function GET(request: Request) {
  const flow = await pendingFlow();
  if (!flow || !("state" in flow))
    return new Response("No sign-in in progress.", { status: 400 });
  const base = origin(request);
  const { pathname, searchParams, search } = new URL(request.url);
  if (searchParams.has("error")) return abandoned(`${base}/?signin=cancelled`);
  const identity = await finishSignIn(new URL(pathname + search, base), flow);
  return signedIn(await signIn(identity), base);
}
