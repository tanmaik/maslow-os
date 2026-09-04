import { deployment } from "@/lib/deployment";
import { beginSignIn } from "@/lib/oidc";
import { origin } from "@/lib/origin";
import { continuing } from "@/lib/session";

// Starts a sign-in at an OpenID Connect provider.
export async function GET(request: Request) {
  if (deployment.identity.kind !== "oidc")
    return new Response(null, { status: 404 });
  const { url, flow } = await beginSignIn(`${origin(request)}/auth/callback`);
  return continuing(url, flow);
}
