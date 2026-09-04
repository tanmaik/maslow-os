import { beginSignIn, origin } from "../../../lib/oidc.ts";
import { continuing } from "../../../lib/session.ts";

// Starts a sign-in at an OpenID Connect provider.
export async function GET(request: Request) {
  const { url, flow } = await beginSignIn(`${origin(request)}/auth/callback`);
  return continuing(url, flow);
}
