import { Resend } from "resend";

import { deployment } from "./deployment.ts";

// Whether mail can go to an address from here: anywhere in production;
// outside it, real mail from a laptop or a preview reaches founders only.
export const mailable = (to: string) =>
  deployment.production || /@maslow\.tech$/i.test(to);

// Sends one plain-text mail through whatever this deployment has. With no mail
// configured there is nothing to send with, and callers show that instead.
export async function send(mail: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (deployment.mail.kind === "none")
    throw new Error("No mail is configured.");
  if (!mailable(mail.to))
    throw new Error(
      `Outside production mail goes to founders only, not ${mail.to}.`,
    );
  const { error } = await new Resend(deployment.mail.apiKey).emails.send({
    from: deployment.mail.from,
    ...mail,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}
