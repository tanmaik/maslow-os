import {
  createSession,
  deleteSession,
  resolveSession,
  type Principal,
} from "@placeholder/db/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { cookie, FLOW, SESSION, SESSION_LIFETIME } from "./cookie.ts";

// What a sign-in remembers between its two legs: the email a code was sent to.
export type Flow = { email: string };

// Who the current request acts as, or null when nobody is signed in.
export async function principal(): Promise<Principal | null> {
  return resolveSession((await cookies()).get(SESSION)?.value);
}

// Opens a session for p and sends the browser to `to` holding it. If the
// membership was removed in the meantime, the browser goes there as it was.
export async function signedIn(p: Principal, to: string): Promise<Response> {
  const token = await createSession(p);
  const response = NextResponse.redirect(to, 303);
  if (token) response.cookies.set(SESSION, token, cookie(SESSION_LIFETIME));
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

// The sign-in in progress, or null when there is none or the cookie is not
// one of ours.
export async function pendingFlow(): Promise<Flow | null> {
  const raw = (await cookies()).get(FLOW)?.value;
  if (!raw) return null;
  try {
    const flow = JSON.parse(raw) as Partial<Flow>;
    if (typeof flow.email === "string") return { email: flow.email };
  } catch {}
  return null;
}
