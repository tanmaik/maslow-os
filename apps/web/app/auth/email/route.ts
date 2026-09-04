import { allow, clear } from "@placeholder/db/throttle";

import { deployment } from "@/lib/deployment";
import { send } from "@/lib/mail";
import { origin } from "@/lib/origin";
import { abandoned, continuing } from "@/lib/session";
import { createCode, WorkOSError } from "@/lib/workos";

// Codes an address may ask for, and codes one network address may ask for,
// per ten minutes.
const PER_EMAIL = 3;
const PER_ADDRESS = 20;
const WINDOW = 10 * 60;

// The longest address a mailbox can have.
const MAX_EMAIL = 254;

// First leg of a code sign-in: a six-digit code goes to the address. Outside
// production, with no mail configured, it goes to the server's terminal
// instead, and the page says so.
export async function POST(request: Request) {
  if (deployment.identity.kind !== "workos")
    return new Response(null, { status: 404 });
  const email = (await request.formData()).get("email");
  if (
    typeof email !== "string" ||
    !email.includes("@") ||
    email.length > MAX_EMAIL
  )
    return new Response("An email address is required.", { status: 400 });
  const address = email.trim().toLowerCase();
  const home = origin(request);

  // The network address is what the nearest proxy reports; with no proxy
  // there is none to count against.
  const from = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const allowed =
    (await allow(`email:${address}`, PER_EMAIL, WINDOW)) &&
    (!from || (await allow(`from:${from}`, PER_ADDRESS, WINDOW)));
  if (!allowed) return abandoned(`${home}/?email=slow`);

  let code: string;
  try {
    code = await createCode(address);
  } catch (err) {
    // WorkOS refusing the address is the person's to fix; anything else is ours.
    if (err instanceof WorkOSError && [400, 422].includes(err.status))
      return abandoned(`${home}/?email=rejected`);
    throw err;
  }
  await clear(`code:${address}`);
  if (deployment.mail.kind === "none") {
    console.log(`sign-in code for ${address}: ${code}`);
  } else {
    await send({
      to: address,
      subject: `${code} is your sign-in code`,
      text: `Enter ${code} at ${home} to sign in. It expires in ten minutes.`,
    });
  }
  return continuing(home, { email: address });
}
