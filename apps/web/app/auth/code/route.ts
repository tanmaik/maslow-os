import { signIn } from "@placeholder/db/auth";
import { allow, clear } from "@placeholder/db/throttle";

import { deployment } from "@/lib/deployment";
import { origin } from "@/lib/origin";
import { abandoned, pendingFlow, signedIn } from "@/lib/session";
import { redeemCode, WorkOSError } from "@/lib/workos";

// Guesses one address gets before its sign-in is abandoned.
const GUESSES = 5;
const WINDOW = 10 * 60;

// Second leg of a code sign-in: the code comes back and a session opens.
export async function POST(request: Request) {
  if (deployment.identity.kind !== "workos")
    return new Response(null, { status: 404 });
  const flow = await pendingFlow();
  if (!flow) return new Response("No sign-in in progress.", { status: 400 });
  const code = (await request.formData()).get("code");
  if (typeof code !== "string")
    return new Response("A code is required.", { status: 400 });
  const home = origin(request);

  const key = `code:${flow.email}`;
  if (!(await allow(key, GUESSES, WINDOW)))
    return abandoned(`${home}/?code=locked`);

  try {
    const identity = await redeemCode(flow.email, code.trim());
    await clear(key);
    // An org founded here starts with computers on outside production.
    return signedIn(
      await signIn({ ...identity, computers: !deployment.production }),
      home,
    );
  } catch (err) {
    if (err instanceof WorkOSError && /one_time_code/.test(err.code))
      return Response.redirect(`${home}/?code=wrong`, 303);
    throw err;
  }
}
