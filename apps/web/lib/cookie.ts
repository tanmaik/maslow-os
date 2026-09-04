import { deployment } from "./deployment.ts";

// The two cookies the app sets: the session, and a sign-in in progress.
export const SESSION = "session";
export const FLOW = "auth_flow";

// A session cookie is renewed on every visit and asks for the longest life a
// browser will grant, so a signed-in person stays signed in until they sign
// out or stay away for over a year.
export const SESSION_LIFETIME = 400 * 24 * 3600;

// The shape of a session token: the org, then the session, both UUIDs.
export const SESSION_TOKEN = /^[0-9a-f-]{36}\.[0-9a-f-]{36}$/;

export const cookie = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: deployment.https,
  path: "/",
  maxAge,
});
