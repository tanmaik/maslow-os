import { Resend } from "resend";

import { deployment } from "./deployment.ts";

// Sends one plain-text mail through whatever this deployment has. With no mail
// configured there is nothing to send with, and callers show that instead.
export async function send(mail: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (deployment.mail.kind === "none")
    throw new Error("No mail is configured.");
  const { error } = await new Resend(deployment.mail.apiKey).emails.send({
    from: deployment.mail.from,
    ...mail,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}
