import {
  createSession,
  deleteSession,
  resolveSession,
  type Principal,
} from "@placeholder/db/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { deployment } from "./deployment.ts";

const SESSION = "session";
const FLOW = "auth_flow";

// What a sign-in remembers between its two legs: the OIDC state and verifier,
// or the email a code was sent to.
export type Flow = { state: string; verifier: string } | { email: string };

const cookie = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: deployment.production,
  path: "/",
  maxAge,
});

// Who the current request acts as, or null when nobody is signed in.
export async function principal(): Promise<Principal | null> {
  return resolveSession((await cookies()).get(SESSION)?.value);
}

// Opens a session for p and sends the browser to `to` holding it.
export async function signedIn(p: Principal, to: string): Promise<Response> {
  const token = await createSession(p);
  const response = NextResponse.redirect(to, 303);
  response.cookies.set(SESSION, token, cookie(30 * 24 * 3600));
  response.cookies.delete(FLOW);
  return response;
}

// Ends the current session and sends the browser to `to` without it.
export async function signedOut(to: string): Promise<Response> {
  await deleteSession((await cookies()).get(SESSION)?.value);
  const response = NextResponse.redirect(to, 303);
  response.cookies.delete(SESSION);
  return response;
}

// Sends the browser to `to` remembering the first leg of a sign-in.
export function continuing(to: string | URL, flow: Flow): Response {
  const response = NextResponse.redirect(to, 303);
  response.cookies.set(FLOW, JSON.stringify(flow), cookie(10 * 60));
  return response;
}

// Sends the browser to `to` having forgotten any sign-in in progress.
export function abandoned(to: string): Response {
  const response = NextResponse.redirect(to, 303);
  response.cookies.delete(FLOW);
  return response;
}

export async function pendingFlow(): Promise<Flow | null> {
  const raw = (await cookies()).get(FLOW)?.value;
  return raw ? (JSON.parse(raw) as Flow) : null;
}
