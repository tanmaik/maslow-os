import { origin } from "../../../lib/oidc.ts";
import { abandoned } from "../../../lib/session.ts";

// Forgets a sign-in in progress so a different address can be used.
export async function POST(request: Request) {
  return abandoned(origin(request));
}
