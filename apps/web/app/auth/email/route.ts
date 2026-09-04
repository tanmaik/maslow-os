import { deployment } from "../../../lib/deployment.ts";
import { send } from "../../../lib/mail.ts";
import { origin } from "../../../lib/oidc.ts";
import { continuing } from "../../../lib/session.ts";
import { createCode } from "../../../lib/workos.ts";

// First leg of a code sign-in: a six-digit code goes to the address. Outside
// production, with no mail configured, it goes to the server's terminal
// instead, and the page says so.
export async function POST(request: Request) {
  const email = (await request.formData()).get("email");
  if (typeof email !== "string" || !email.includes("@"))
    return new Response("An email address is required.", { status: 400 });
  const address = email.trim().toLowerCase();
  const code = await createCode(address);
  if (deployment.mail.kind === "none") {
    console.log(`sign-in code for ${address}: ${code}`);
  } else {
    await send({
      to: address,
      subject: `${code} is your sign-in code`,
      text: `Enter ${code} at ${origin(request)} to sign in. It expires in ten minutes.`,
    });
  }
  return continuing(origin(request), { email: address });
}
