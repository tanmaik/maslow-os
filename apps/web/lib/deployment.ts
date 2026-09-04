// What this deployment can do, read from its environment once. The interface
// reads this object and never the environment.

export type IdentityProvider =
  | { kind: "workos"; clientId: string; apiKey: string }
  | { kind: "oidc"; issuer: string; clientId: string; clientSecret?: string }
  | { kind: "dev" };

export type Mail =
  { kind: "resend"; apiKey: string; from: string } | { kind: "none" };

// Production is the live Vercel environment or any box that is not a
// development server and not a Vercel preview.
const production = process.env.VERCEL
  ? process.env.VERCEL_ENV === "production"
  : process.env.NODE_ENV === "production";

// Every Vercel deployment is served over HTTPS; elsewhere only production is.
const https = Boolean(process.env.VERCEL) || production;

function identityProvider(): IdentityProvider {
  const { WORKOS_API_KEY, WORKOS_CLIENT_ID, AUTH_ISSUER, AUTH_CLIENT_ID } =
    process.env;
  if (WORKOS_API_KEY && WORKOS_CLIENT_ID)
    return {
      kind: "workos",
      clientId: WORKOS_CLIENT_ID,
      apiKey: WORKOS_API_KEY,
    };
  if (AUTH_ISSUER && AUTH_CLIENT_ID) {
    return {
      kind: "oidc",
      issuer: AUTH_ISSUER,
      clientId: AUTH_CLIENT_ID,
      clientSecret: process.env.AUTH_CLIENT_SECRET || undefined,
    };
  }
  if (production) {
    throw new Error(
      "No identity provider: set WORKOS_API_KEY and WORKOS_CLIENT_ID, or AUTH_ISSUER and AUTH_CLIENT_ID. Production has no fallback sign-in.",
    );
  }
  return { kind: "dev" };
}

function mail(): Mail {
  const { RESEND_API_KEY, MAIL_FROM } = process.env;
  if (RESEND_API_KEY && MAIL_FROM)
    return { kind: "resend", apiKey: RESEND_API_KEY, from: MAIL_FROM };
  return { kind: "none" };
}

export const deployment = {
  production,
  https,
  identity: identityProvider(),
  mail: mail(),
};

// A code sign-in mails its codes, so in production WorkOS without mail is a
// deployment nobody can enter.
if (
  production &&
  deployment.identity.kind === "workos" &&
  deployment.mail.kind === "none"
) {
  throw new Error(
    "WorkOS sign-in mails its codes: set RESEND_API_KEY and MAIL_FROM.",
  );
}
