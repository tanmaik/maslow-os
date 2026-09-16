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
      // Every key under this; previews each get their own, reaped with them.
      prefix: string;
    }
  | { kind: "local"; dir: string }
  | { kind: "none" };

// Product analytics go to PostHog, or nowhere. The key is the project token:
// write-only, made to be given to a browser.
export type Analytics = { kind: "posthog"; key: string } | { kind: "none" };

// Vectors for the brain's recall come from Voyage, or from a stand-in that
// hashes words, or from nowhere, in which case there is no recall.
export type Embeddings =
  | { kind: "voyage"; apiKey: string; model: string }
  | { kind: "fake" }
  | { kind: "none" };

// Connections to outside apps are held at Composio, or by a fake with a
// few pretend apps, or nowhere.
export type Connections =
  | { kind: "composio"; apiKey: string; api: string }
  | { kind: "fake" }
  | { kind: "none" };

// Computers are Fly machines in one Fly app, or off. There is no fake: a
// deployment without Fly's token makes nobody a computer and says so.
// Outside production every machine carries the checkout that made it, so
// the reap can tell a laptop's from a preview's.
export type Computers =
  | {
      kind: "fly";
      token: string;
      app: string;
      // Every machine has its own name under this: `<machine>.<domain>`.
      domain: string;
      checkout: string | null;
      // Where a machine reaches this deployment's brain, or null where it
      // cannot, as on a laptop.
      brain: string | null;
    }
  | { kind: "none" };

// Model keys for the computers come from OpenRouter, minted per person
// with a provisioning key of ours, or from nowhere, in which case Claude
// Code on a computer runs on the person's own account and the page says
// so. Not a fallback: a deployment without one has the feature off, in
// the open.
export type Models =
  | { kind: "openrouter"; provisioningKey: string; capUsd: number }
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
    return {
      kind: "s3",
      endpoint,
      region,
      bucket,
      accessKey,
      secretKey,
      prefix: process.env.STORAGE_PREFIX ?? "",
    };
  if (production) {
    throw new Error(
      "No object storage: set STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY. Production has no fallback.",
    );
  }
  if (process.env.VERCEL) return { kind: "none" };
  return { kind: "local", dir: process.env.UPLOADS_DIR ?? ".local/uploads" };
}

function analytics(): Analytics {
  const key = process.env.POSTHOG_KEY;
  if (key) return { kind: "posthog", key };
  if (production)
    throw new Error(
      "No analytics: set POSTHOG_KEY. Production has no fallback.",
    );
  return { kind: "none" };
}

// A deployment without Voyage has no recall in production, and a stand-in
// anywhere else.
function embeddings(): Embeddings {
  const { VOYAGE_API_KEY: apiKey } = process.env;
  if (apiKey)
    return {
      kind: "voyage",
      apiKey,
      model: "voyage-4-lite",
    };
  return production ? { kind: "none" } : { kind: "fake" };
}

// A deployment without Composio has no connections in production, and
// pretend ones anywhere else.
function connections(): Connections {
  const { COMPOSIO_API_KEY: apiKey } = process.env;
  if (apiKey)
    return {
      kind: "composio",
      apiKey,
      api: process.env.COMPOSIO_API_HOST ?? "https://backend.composio.dev",
    };
  return production ? { kind: "none" } : { kind: "fake" };
}

function computers(): Computers {
  const {
    FLY_API_TOKEN: token,
    FLY_COMPUTERS_APP: app,
    FLY_MACHINES_DOMAIN: domain,
  } = process.env;
  // The address a machine reaches the app at: production's own, or the
  // preview branch's, which outlives any one push. Production without one
  // would make computers that cannot reach the brain, and says so instead.
  const site = production
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL
    : process.env.VERCEL_BRANCH_URL;
  if (production && token && app && domain && !site)
    throw new Error(
      "No address for computers to reach the brain at: set VERCEL_PROJECT_PRODUCTION_URL. Production has no fallback.",
    );
  if (token && app && domain)
    return {
      kind: "fly",
      token,
      app,
      domain,
      checkout: production ? null : (process.env.CHECKOUT ?? "laptop"),
      brain: site ? `https://${site}/mcp` : null,
    };
  if (production)
    throw new Error(
      "No computers: set FLY_API_TOKEN, FLY_COMPUTERS_APP and FLY_MACHINES_DOMAIN. Production has no fallback.",
    );
  return { kind: "none" };
}

// The cap is what a person may spend on models in a week, in dollars: the
// one ceiling of ours they are shown, and the default a computer's row
// carries from the day its key is minted.
function models(): Models {
  const provisioningKey = process.env.OPENROUTER_PROVISIONING_KEY;
  if (!provisioningKey) return { kind: "none" };
  return { kind: "openrouter", provisioningKey, capUsd: 5 };
}

// The sweep is what meters and cleans; production without its cron's
// secret would run none of it and say nothing.
if (production && !process.env.CRON_SECRET)
  throw new Error("Production needs CRON_SECRET for the hourly sweep.");

// The relay that holds a record's live document while people are in it,
// reached by the browser over a socket on a ticket this app signs with the
// secret the two share. The ticket names where the relay calls this
// deployment back: its own address, never one a request claimed. The
// relay's address is given outright where the dev stack runs one beside
// the app, and found on Fly otherwise, where the sweep keeps one. Without
// a secret nothing is live and the page saves as it does alone; production
// has no such mode.
type Sync =
  | { kind: "relay"; url: string | null; secret: string; origin: string }
  | { kind: "none" };
function sync(): Sync {
  const { SYNC_URL: url, SYNC_SECRET: secret } = process.env;
  const site = production
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL
    : (process.env.VERCEL_BRANCH_URL ?? process.env.APP_URL);
  if (production && !secret)
    throw new Error(
      "No relay for live editing: set SYNC_SECRET. Production has no fallback.",
    );
  if (!secret || !site) return { kind: "none" };
  const origin = site.startsWith("http") ? site : `https://${site}`;
  return { kind: "relay", url: url ?? null, secret, origin };
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
  computers: computers(),
  models: models(),
  connections: connections(),
  embeddings: embeddings(),
  sync: sync(),
  https,
  identity: identityProvider(),
  mail: mail(),
  analytics: analytics(),
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
