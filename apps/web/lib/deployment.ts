// What this deployment can do, read from its environment once. The interface
// reads this object and never the environment.

export type IdentityProvider =
  { kind: "workos"; clientId: string; apiKey: string } | { kind: "dev" };

export type Mail =
  { kind: "resend"; apiKey: string; from: string } | { kind: "none" };

// Uploaded images live in an S3-compatible store, or in a directory on a
// real machine, or nowhere.
export type Storage =
  | {
      kind: "s3";
      endpoint: string;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
    }
  | { kind: "local"; dir: string }
  | { kind: "none" };

// Production is the live Vercel environment or any box that is not a
// development server and not a Vercel preview.
const production = process.env.VERCEL
  ? process.env.VERCEL_ENV === "production"
  : process.env.NODE_ENV === "production";

// Every Vercel deployment is served over HTTPS; elsewhere only production is.
const https = Boolean(process.env.VERCEL) || production;

function identityProvider(): IdentityProvider {
  const { WORKOS_API_KEY, WORKOS_CLIENT_ID } = process.env;
  if (WORKOS_API_KEY && WORKOS_CLIENT_ID)
    return {
      kind: "workos",
      clientId: WORKOS_CLIENT_ID,
      apiKey: WORKOS_API_KEY,
    };
  if (production) {
    throw new Error(
      "No identity provider: set WORKOS_API_KEY and WORKOS_CLIENT_ID. Production has no fallback sign-in.",
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

function storage(): Storage {
  const {
    STORAGE_ENDPOINT: endpoint,
    STORAGE_REGION: region,
    STORAGE_BUCKET: bucket,
    STORAGE_ACCESS_KEY: accessKey,
    STORAGE_SECRET_KEY: secretKey,
  } = process.env;
  if (endpoint && region && bucket && accessKey && secretKey)
    return { kind: "s3", endpoint, region, bucket, accessKey, secretKey };
  if (production) {
    throw new Error(
      "No object storage: set STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY. Production has no fallback.",
    );
  }
  if (process.env.VERCEL) return { kind: "none" };
  return { kind: "local", dir: process.env.UPLOADS_DIR ?? ".local/uploads" };
}

export const deployment = {
  production,
  // Which of the three environments this is, for the developer's pill.
  where: production
    ? ("production" as const)
    : process.env.VERCEL
      ? ("preview" as const)
      : ("local" as const),
  // Anywhere but production the seed exists and a seeded person can be
  // signed in as with one click.
  seededSignIn: !production,
  storage: storage(),
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
