import type { Identity } from "@placeholder/db/auth";
import * as client from "openid-client";

import { deployment } from "./deployment.ts";

const shared = globalThis as { __oidc?: Promise<client.Configuration> };

// The identity provider's metadata, discovered once per process.
function configuration(): Promise<client.Configuration> {
  if (deployment.identity.kind !== "oidc")
    throw new Error("No identity provider is configured.");
  const { issuer, clientId, clientSecret } = deployment.identity;
  shared.__oidc ??= client.discovery(
    new URL(issuer),
    clientId,
    undefined,
    clientSecret ? client.ClientSecretPost(clientSecret) : client.None(),
  );
  return shared.__oidc;
}

// What the browser must bring back from the provider for the code to count.
export type OidcFlow = { state: string; verifier: string };

// Where to send the browser to sign in, and what to remember until it returns.
export async function beginSignIn(
  redirectUri: string,
): Promise<{ url: URL; flow: OidcFlow }> {
  const config = await configuration();
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
  });
  return { url, flow: { state, verifier } };
}

// Turns the provider's callback into the identity it vouches for.
export async function finishSignIn(
  callbackUrl: URL,
  flow: OidcFlow,
): Promise<Identity> {
  const config = await configuration();
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
  });
  const sub = tokens.claims()?.sub;
  if (!sub) throw new Error("The identity provider returned no subject.");
  const info = await client.fetchUserInfo(config, tokens.access_token, sub);
  if (typeof info.email !== "string")
    throw new Error("The identity provider returned no email.");
  return {
    email: info.email.toLowerCase(),
    name: typeof info.name === "string" ? info.name : info.email.split("@")[0]!,
  };
}
