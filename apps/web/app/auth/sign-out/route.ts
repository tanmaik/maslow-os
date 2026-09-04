import { origin } from "../../../lib/oidc.ts";
import { signedOut } from "../../../lib/session.ts";

export async function POST(request: Request) {
  return signedOut(origin(request));
}
